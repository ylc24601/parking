import { readFileSync } from 'node:fs'
import { normalizePlate } from '@/lib/plate'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import {
  collectDependents,
  computeEligibility,
  deriveRosterEligibility,
  longestCell,
  MAX_CELL_CODEPOINTS,
  MAX_REPORT_ITEMS,
  parseCsv,
  parseFormDate,
  parseMobilePhone,
  validateRow,
  type Dependent,
  type EligibilityResult,
  type P2Reason,
  type RawRow,
  type ReasonType,
  type RosterPriority,
} from '@/lib/memberImport'

// Phase 6 / Wave 0 — import a member CSV into users + vehicles (+ P2 eligibility + dependents).
// Members are keyed by mobile phone; several rows with the same phone are one member with several
// vehicles. line_id is never touched. Dry-run by default at the CLI.
//
// Two CSV shapes, auto-detected from headers (parseCsv → profile):
//   p2_application — the church P2 application form (numeric 申請原因 + dependents) → eligibility per row
//   roster         — a general member roster (優先序 P1/P2/P3, mostly P3) → P1/P3 write NO eligibility,
//                    P2 writes a review-required eligibility summary (no dates in the roster).
// A P1/P3 roster row NEVER revokes an existing member's P2 (eligibility revocation is the review
// tool, #10); if the member already had P2, it is reported in p2Retained as an untouched warning.
//
// PII note: this reads a real member file. The report is operator-facing and may contain
// names/plates/phones — it must NOT be logged or persisted.

export interface ImportReport {
  dryRun: boolean
  rows: number
  members: number
  imported: number
  updated: number
  vehiclesAdded: number
  dependentsAdded: number
  phoneNameConflicts: Array<{ phone: string; names: string[]; existingName?: string }>
  plateConflicts: Array<{ phone: string; plates: string[] }>
  // CSV self-contradiction: one plate claimed by >1 phone in THIS file. Distinct from plateConflicts
  // (a plate already owned by another member in the DB) — the whole member is skipped, fail closed.
  batchPlateConflicts: Array<{ plate: string; phones: string[] }>
  // Same phone, inconsistent priority (or P2 事由) across rows — the whole member is skipped.
  priorityConflicts: Array<{ phone: string; priorities: string[]; reasons: string[] }>
  reviewRequired: Array<{ phone: string; reason: string }>
  // Existing-P2 member marked P1/P3 in a roster import: eligibility kept, NOT revoked (warning).
  p2Retained: Array<{ phone: string }>
  validationErrors: Array<{ line: number; errors: string[] }>
  // True if any list was truncated to MAX_REPORT_ITEMS; totals hold the untruncated counts.
  truncated: boolean
  totals: {
    phoneNameConflicts: number
    plateConflicts: number
    batchPlateConflicts: number
    priorityConflicts: number
    reviewRequired: number
    p2Retained: number
    validationErrors: number
  }
}

// Thrown when an APPLY partially succeeded: some members were written before a later
// repo call failed. Carries a safe report of what completed (no raw DB error) so the
// operator learns the DB is partially written, not that "nothing happened".
export class CsvImportExecutionError extends Error {
  constructor(readonly processedMembers: number, readonly report: ImportReport) {
    super('partial_apply')
    this.name = 'CsvImportExecutionError'
  }
}

interface ParsedRow {
  line: number
  name: string
  phone: string
  plate: string
  // p2_application only
  reasonType: ReasonType | null
  remarks: string
  applicationDate: string | null
  dependents: Dependent[]
  // roster only
  priority: RosterPriority | null
  rosterReason: P2Reason | null
}

const dedupeKey = (d: Dependent) => `${d.kind}|${d.name}|${d.birthdate ?? ''}`

// Core pipeline over CSV TEXT. Throws CsvImportError for structural problems (parseCsv),
// and CsvImportExecutionError if an apply fails partway through.
export async function importMembersFromCsvText(
  params: { csvText: string; dryRun: boolean; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ImportReport> {
  const { csvText, dryRun, now = new Date() } = params
  const { rows: records, profile } = parseCsv(csvText)

  const report: ImportReport = {
    dryRun, rows: records.length, members: 0, imported: 0, updated: 0, vehiclesAdded: 0, dependentsAdded: 0,
    phoneNameConflicts: [], plateConflicts: [], batchPlateConflicts: [], priorityConflicts: [],
    reviewRequired: [], p2Retained: [], validationErrors: [],
    truncated: false,
    totals: {
      phoneNameConflicts: 0, plateConflicts: 0, batchPlateConflicts: 0, priorityConflicts: 0,
      reviewRequired: 0, p2Retained: 0, validationErrors: 0,
    },
  }

  // Validate + parse; a row with errors (or an implausibly long cell) is reported and excluded.
  // A failing row whose PHONE is still parseable taints that whole member (row-completeness):
  // we never silently import only the good rows of a member whose other row was rejected.
  const parsed: ParsedRow[] = []
  const invalidPhones = new Set<string>()
  // A rejected row taints its member (by parseable phone) so the group is skipped wholesale —
  // this must happen on EVERY reject path, including the over-long-cell one.
  const rejectRow = (line: number, errors: string[], row: RawRow) => {
    pushCapped(report.validationErrors, { line, errors })
    report.totals.validationErrors++
    const pp = parseMobilePhone(row.mobile_phone)
    if (pp.ok) invalidPhones.add(pp.phone)
  }

  records.forEach((row, i) => {
    const line = i + 2 // header is line 1
    if (longestCell(row) > MAX_CELL_CODEPOINTS) {
      rejectRow(line, [`a field exceeds ${MAX_CELL_CODEPOINTS} characters`], row)
      return
    }
    const v = validateRow(row, profile)
    if (!v.ok) {
      rejectRow(line, v.errors, row)
      return
    }
    const base = {
      line,
      name: (row.applicant_name ?? '').trim(),
      phone: v.phone,
      plate: (row.license_plate ?? '').trim(),
    }
    parsed.push(
      v.profile === 'roster'
        ? { ...base, reasonType: null, remarks: '', applicationDate: null, dependents: [], priority: v.priority, rosterReason: v.reason }
        : {
            ...base,
            reasonType: v.reasonType,
            remarks: row.remarks ?? '',
            applicationDate: row.application_date ? row.application_date.trim() : null,
            dependents: collectDependents(row, v.reasonType),
            priority: null,
            rosterReason: null,
          },
    )
  })

  // Batch-local plate preflight: a plate claimed by >1 phone in THIS file is a human error in the
  // list. Report each such plate once and fail the affected members closed (dry-run == apply). This
  // catches conflicts the per-row DB dry-run cannot see (neither member is written yet).
  const plateOwners = new Map<string, Set<string>>()
  for (const r of parsed) {
    const norm = normalizePlate(r.plate)
    if (!norm) continue
    let owners = plateOwners.get(norm)
    if (!owners) { owners = new Set(); plateOwners.set(norm, owners) }
    owners.add(r.phone)
  }
  const conflictedPlates = new Set<string>()
  for (const [plate, phones] of plateOwners) {
    if (phones.size > 1) {
      conflictedPlates.add(plate)
      pushCapped(report.batchPlateConflicts, { plate, phones: [...phones] })
      report.totals.batchPlateConflicts++
    }
  }

  // Group by phone (several vehicles per member).
  const groups = new Map<string, ParsedRow[]>()
  for (const r of parsed) {
    const g = groups.get(r.phone) ?? []
    g.push(r)
    groups.set(r.phone, g)
  }

  let processedMembers = 0
  for (const [phone, rows] of groups) {
    report.members++

    // Row-completeness: another row for this phone failed validation → skip the whole member.
    if (invalidPhones.has(phone)) {
      pushCapped(report.validationErrors, { line: rows[0].line, errors: ['member skipped: another row for this mobile_phone failed validation'] })
      report.totals.validationErrors++
      continue
    }

    const names = [...new Set(rows.map(r => r.name))]
    if (names.length > 1) {
      pushCapped(report.phoneNameConflicts, { phone, names }) // same phone, different names — ambiguous
      report.totals.phoneNameConflicts++
      continue
    }
    const name = names[0]

    // Resolve reason + eligibility per profile. roster P1/P3 → no eligibility (reason null).
    let reason: string | null
    let elig: EligibilityResult | null
    let dependents: Dependent[] = []
    if (profile === 'roster') {
      const priorities = [...new Set(rows.map(r => r.priority))] as RosterPriority[]
      if (priorities.length > 1) {
        pushCapped(report.priorityConflicts, { phone, priorities, reasons: [] })
        report.totals.priorityConflicts++
        continue
      }
      if (priorities[0] === 'P2') {
        const reasons = [...new Set(rows.map(r => r.rosterReason))].filter(Boolean) as P2Reason[]
        if (reasons.length > 1) {
          pushCapped(report.priorityConflicts, { phone, priorities, reasons })
          report.totals.priorityConflicts++
          continue
        }
        reason = reasons[0]
        elig = deriveRosterEligibility(reasons[0], now)
      } else {
        reason = null // P1/P3: general member, no eligibility
        elig = null
      }
    } else {
      const first = rows[0]
      dependents = [...new Map(rows.flatMap(r => r.dependents).map(d => [dedupeKey(d), d])).values()]
      const childBirthdates = dependents.filter(d => d.kind === 'child' && d.birthdate).map(d => d.birthdate as string)
      elig = computeEligibility({
        reasonType: first.reasonType as ReasonType, remarks: first.remarks,
        applicationDate: first.applicationDate ? parseFormDate(first.applicationDate) : null,
        childBirthdates, now,
      })
      reason = elig.p2_reason
    }

    const plates = [...new Set(rows.map(r => r.plate).filter(Boolean))]
    // Batch-local plate conflict → skip the whole member (already reported per-plate above).
    if (plates.some(p => conflictedPlates.has(normalizePlate(p)))) continue

    let res
    try {
      res = await repo.importMember({
        name, phone, plates, reason,
        validUntil: elig?.valid_until ?? null, reviewDate: elig?.review_date ?? null, dependents, dryRun,
      })
    } catch {
      // Per-member RPC is atomic, but the whole CSV is not one transaction. On a write,
      // members processed BEFORE this point are already committed — surface that as a
      // typed partial rather than a generic 500 that reads as "nothing was written".
      finalizeTruncation(report)
      throw new CsvImportExecutionError(processedMembers, report)
    }

    if (res.status === 'phone_name_conflict') {
      pushCapped(report.phoneNameConflicts, { phone, names: [name], existingName: res.existing_name })
      report.totals.phoneNameConflicts++
      continue
    }
    if (res.status === 'imported') report.imported++
    else report.updated++
    report.vehiclesAdded += res.vehicles_added ?? 0
    report.dependentsAdded += res.dependents_added ?? 0
    if (res.plate_conflicts && res.plate_conflicts.length > 0) {
      pushCapped(report.plateConflicts, { phone, plates: res.plate_conflicts })
      report.totals.plateConflicts++
    }
    if (reason !== null && elig?.reviewRequired) {
      pushCapped(report.reviewRequired, { phone, reason: elig.p2_reason })
      report.totals.reviewRequired++
    }
    // Roster P1/P3 landing on a member who already had P2: eligibility kept, not revoked.
    if (res.retained_p2) {
      pushCapped(report.p2Retained, { phone })
      report.totals.p2Retained++
    }
    if (!dryRun) processedMembers++
  }

  finalizeTruncation(report)
  return report
}

// Cap a report list so a pathological file can't return a giant payload. The total
// counters keep the real numbers.
function pushCapped<T>(list: T[], item: T): void {
  if (list.length < MAX_REPORT_ITEMS) list.push(item)
}
function finalizeTruncation(report: ImportReport): void {
  report.truncated =
    report.totals.validationErrors > report.validationErrors.length ||
    report.totals.phoneNameConflicts > report.phoneNameConflicts.length ||
    report.totals.plateConflicts > report.plateConflicts.length ||
    report.totals.batchPlateConflicts > report.batchPlateConflicts.length ||
    report.totals.priorityConflicts > report.priorityConflicts.length ||
    report.totals.reviewRequired > report.reviewRequired.length ||
    report.totals.p2Retained > report.p2Retained.length
}

// CLI / file-path entry point (unchanged contract): read the file, then run the shared
// text pipeline. Kept so scripts/run-members-import.ts and the file-path integration
// tests work without changes.
export async function importMembersFromCsv(
  params: { filePath: string; dryRun: boolean; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ImportReport> {
  const csvText = readFileSync(params.filePath, 'utf8')
  return importMembersFromCsvText({ csvText, dryRun: params.dryRun, now: params.now }, repo)
}
