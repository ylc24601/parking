import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import {
  collectDependents,
  computeEligibility,
  normalizePhone,
  parseFormDate,
  validateRow,
  type Dependent,
  type RawRow,
  type ReasonType,
} from '@/lib/memberImport'

// Phase 6 — import the church P2 application CSV into users + vehicles + user_eligibility +
// eligibility_dependents. Members are keyed by mobile phone; several rows with the same phone are
// one member with several vehicles. line_id is never touched. Dry-run by default at the CLI.
//
// PII note: this reads a real member file (run locally by an operator). The report is
// operator-facing and may contain names/plates — do NOT paste it into shared logs.

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

export async function importMembersFromCsv(
  params: { filePath: string; dryRun: boolean; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ImportReport> {
  const { filePath, dryRun, now = new Date() } = params
  const raw = readFileSync(filePath, 'utf8')
  const records = parse(raw, { columns: true, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as RawRow[]

  const report: ImportReport = {
    dryRun, rows: records.length, members: 0, imported: 0, updated: 0, vehiclesAdded: 0, dependentsAdded: 0,
    phoneNameConflicts: [], plateConflicts: [], reviewRequired: [], validationErrors: [],
  }

  // Validate + parse; rows with errors are reported and excluded.
  const parsed: ParsedRow[] = []
  records.forEach((row, i) => {
    const line = i + 2 // header is line 1
    const { reasonType, errors } = validateRow(row)
    if (errors.length > 0 || reasonType === null) {
      report.validationErrors.push({ line, errors })
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

  for (const [phone, rows] of groups) {
    report.members++
    const names = [...new Set(rows.map(r => r.name))]
    if (names.length > 1) {
      report.phoneNameConflicts.push({ phone, names }) // same phone, different names — ambiguous
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

    const res = await repo.importMember({
      name, phone, plates, reason: elig.p2_reason,
      validUntil: elig.valid_until, reviewDate: elig.review_date, dependents, dryRun,
    })

    if (res.status === 'phone_name_conflict') {
      report.phoneNameConflicts.push({ phone, names: [name], existingName: res.existing_name })
      continue
    }
    if (res.status === 'imported') report.imported++
    else report.updated++
    report.vehiclesAdded += res.vehicles_added ?? 0
    report.dependentsAdded += res.dependents_added ?? 0
    if (res.plate_conflicts && res.plate_conflicts.length > 0) report.plateConflicts.push({ phone, plates: res.plate_conflicts })
    if (elig.reviewRequired) report.reviewRequired.push({ phone, reason: elig.p2_reason })
  }

  return report
}
