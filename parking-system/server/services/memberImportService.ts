import { readFileSync } from 'node:fs'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import {
  collectDependents,
  computeEligibility,
  longestCell,
  MAX_CELL_CODEPOINTS,
  MAX_REPORT_ITEMS,
  normalizePhone,
  parseCsv,
  parseFormDate,
  validateRow,
  type Dependent,
  type ReasonType,
} from '@/lib/memberImport'

// Phase 6 — import the church P2 application CSV into users + vehicles + user_eligibility +
// eligibility_dependents. Members are keyed by mobile phone; several rows with the same phone are
// one member with several vehicles. line_id is never touched. Dry-run by default at the CLI.
//
// Phase 8 Slice 5 — an Admin UI wraps this: importMembersFromCsvText takes the CSV TEXT (from an
// upload) so the CLI (file path) and the route (request body) share one pipeline.
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
  reviewRequired: Array<{ phone: string; reason: string }>
  validationErrors: Array<{ line: number; errors: string[] }>
  // True if any list was truncated to MAX_REPORT_ITEMS; totals hold the untruncated counts.
  truncated: boolean
  totals: { phoneNameConflicts: number; plateConflicts: number; reviewRequired: number; validationErrors: number }
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
  reasonType: ReasonType
  remarks: string
  applicationDate: string | null
  dependents: Dependent[]
}

const dedupeKey = (d: Dependent) => `${d.kind}|${d.name}|${d.birthdate ?? ''}`

// Core pipeline over CSV TEXT. Throws CsvImportError for structural problems (parseCsv),
// and CsvImportExecutionError if an apply fails partway through.
export async function importMembersFromCsvText(
  params: { csvText: string; dryRun: boolean; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ImportReport> {
  const { csvText, dryRun, now = new Date() } = params
  const records = parseCsv(csvText)

  const report: ImportReport = {
    dryRun, rows: records.length, members: 0, imported: 0, updated: 0, vehiclesAdded: 0, dependentsAdded: 0,
    phoneNameConflicts: [], plateConflicts: [], reviewRequired: [], validationErrors: [],
    truncated: false, totals: { phoneNameConflicts: 0, plateConflicts: 0, reviewRequired: 0, validationErrors: 0 },
  }

  // Validate + parse; rows with errors (or an implausibly long cell) are reported and excluded.
  const parsed: ParsedRow[] = []
  records.forEach((row, i) => {
    const line = i + 2 // header is line 1
    if (longestCell(row) > MAX_CELL_CODEPOINTS) {
      pushCapped(report.validationErrors, { line, errors: [`a field exceeds ${MAX_CELL_CODEPOINTS} characters`] })
      report.totals.validationErrors++
      return
    }
    const { reasonType, errors } = validateRow(row)
    if (errors.length > 0 || reasonType === null) {
      pushCapped(report.validationErrors, { line, errors })
      report.totals.validationErrors++
      return
    }
    parsed.push({
      line,
      name: (row.applicant_name ?? '').trim(),
      phone: normalizePhone(row.mobile_phone),
      plate: (row.license_plate ?? '').trim(),
      reasonType,
      remarks: row.remarks ?? '',
      applicationDate: row.application_date ? row.application_date.trim() : null,
      dependents: collectDependents(row, reasonType),
    })
  })

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
    const names = [...new Set(rows.map(r => r.name))]
    if (names.length > 1) {
      pushCapped(report.phoneNameConflicts, { phone, names }) // same phone, different names — ambiguous
      report.totals.phoneNameConflicts++
      continue
    }
    const name = names[0]
    const plates = [...new Set(rows.map(r => r.plate).filter(Boolean))]
    const dependents = [...new Map(rows.flatMap(r => r.dependents).map(d => [dedupeKey(d), d])).values()]
    const first = rows[0]
    const childBirthdates = dependents.filter(d => d.kind === 'child' && d.birthdate).map(d => d.birthdate as string)
    const elig = computeEligibility({
      reasonType: first.reasonType, remarks: first.remarks,
      applicationDate: first.applicationDate ? parseFormDate(first.applicationDate) : null,
      childBirthdates, now,
    })

    let res
    try {
      res = await repo.importMember({
        name, phone, plates, reason: elig.p2_reason,
        validUntil: elig.valid_until, reviewDate: elig.review_date, dependents, dryRun,
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
    if (elig.reviewRequired) {
      pushCapped(report.reviewRequired, { phone, reason: elig.p2_reason })
      report.totals.reviewRequired++
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
    report.totals.reviewRequired > report.reviewRequired.length
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
