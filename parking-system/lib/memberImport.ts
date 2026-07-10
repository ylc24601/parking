// Phase 6 — pure helpers for the member-import CLI (P2 application CSV → schema). No I/O;
// unit-tested. See docs/delivery-model-and-roadmap.md for the CSV→schema mapping.

export type ReasonType = 1 | 2 | 3 | 4
export type P2Reason = 'mobility_long' | 'mobility_short' | 'pregnancy' | 'elderly_companion' | 'child_companion'
export type DependentKind = 'impaired' | 'child' | 'elder'
export interface Dependent {
  kind: DependentKind
  name: string
  birthdate: string | null // ISO YYYY-MM-DD
}

// mobile phone → digits only (the member identity key). Empty string if none.
export function normalizePhone(raw: string | undefined | null): string {
  return (raw ?? '').replace(/\D/g, '')
}

// A Taiwan mobile number: 09 + 8 digits (10 total), evaluated on the normalized (digits-only) form.
// Guards the phone identity key so junk like "1" / landline-style numbers can't reach users_phone_key.
export function isValidTaiwanMobilePhone(phone: string): boolean {
  return /^09\d{8}$/.test(phone)
}

// Accept YYYY-MM-DD or YYYY/MM/DD (the form mixes both) → ISO YYYY-MM-DD, else null.
export function parseFormDate(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim()
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const month = Number(mo), day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function isPregnancy(remarks: string | undefined | null): boolean {
  return /懷孕|pregnan/i.test(remarks ?? '')
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10)
}
function addYearsISO(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10)
}
function maxISO(dates: string[]): string {
  return dates.reduce((a, b) => (b > a ? b : a))
}

const TEMP_MONTHS = 6 // mobility_short / pregnancy validity window from application date
const CHILD_MAX_AGE = 5 // child eligibility ends at the 5th birthday

export interface EligibilityInput {
  reasonType: ReasonType
  remarks?: string | null
  applicationDate?: string | null // ISO
  childBirthdates?: string[]       // ISO, present children only
  now?: Date
}
export interface EligibilityResult {
  p2_reason: P2Reason
  valid_until: string | null // null = permanent OR review-required (disambiguate via reviewRequired)
  review_date: string | null
  reviewRequired: boolean
}

// Maps reason_type → p2_reason and computes the eligibility window (decision 3):
//   mobility_long / elderly_companion → permanent
//   mobility_short / pregnancy        → application_date + 6 months; missing date → review_required
//   child_companion                   → max(child birthdate) + 5 years; no birthdate → review_required
export function computeEligibility(input: EligibilityInput): EligibilityResult {
  const { reasonType, remarks, applicationDate, childBirthdates = [], now = new Date() } = input
  const hasChildren = childBirthdates.length > 0
  const today = now.toISOString().slice(0, 10)

  const p2_reason: P2Reason =
    reasonType === 1 ? 'mobility_long'
    : reasonType === 2 ? 'mobility_short'
    : reasonType === 4 ? 'elderly_companion'
    : isPregnancy(remarks) && !hasChildren ? 'pregnancy'
    : 'child_companion'

  if (p2_reason === 'mobility_long' || p2_reason === 'elderly_companion') {
    return { p2_reason, valid_until: null, review_date: null, reviewRequired: false }
  }

  if (p2_reason === 'mobility_short' || p2_reason === 'pregnancy') {
    if (!applicationDate) return { p2_reason, valid_until: null, review_date: today, reviewRequired: true }
    const until = addMonthsISO(applicationDate, TEMP_MONTHS)
    return { p2_reason, valid_until: until, review_date: until, reviewRequired: false }
  }

  // child_companion
  if (!hasChildren) return { p2_reason, valid_until: null, review_date: today, reviewRequired: true }
  const until = addYearsISO(maxISO(childBirthdates), CHILD_MAX_AGE)
  return { p2_reason, valid_until: until, review_date: until, reviewRequired: false }
}

// Raw CSV row keyed by the form's field_name headers.
export type RawRow = Record<string, string>

export function collectDependents(row: RawRow, reasonType: ReasonType): Dependent[] {
  if (reasonType === 1 || reasonType === 2) {
    const name = (row.impaired_person_name ?? '').trim()
    return name ? [{ kind: 'impaired', name, birthdate: null }] : []
  }
  if (reasonType === 4) {
    const name = (row.elder_1_name ?? '').trim()
    return name ? [{ kind: 'elder', name, birthdate: parseFormDate(row.elder_1_birthdate) }] : []
  }
  // reason 3: children (pregnancy has no dependent)
  const out: Dependent[] = []
  for (const i of [1, 2, 3]) {
    const name = (row[`child_${i}_name`] ?? '').trim()
    if (name) out.push({ kind: 'child', name, birthdate: parseFormDate(row[`child_${i}_birthdate`]) })
  }
  return out
}

// Row-level validation → human-readable errors (operator-facing; the operator runs on the PII file
// locally). Non-fatal: the batch continues and reports.
export function validateRow(row: RawRow): { reasonType: ReasonType | null; errors: string[] } {
  const errors: string[] = []
  if (!(row.applicant_name ?? '').trim()) errors.push('missing applicant_name')
  const phone = normalizePhone(row.mobile_phone)
  if (!phone) errors.push('missing mobile_phone')
  else if (!isValidTaiwanMobilePhone(phone)) errors.push(`invalid mobile_phone "${row.mobile_phone}" (expect Taiwan mobile 09XXXXXXXX)`)
  if (!(row.license_plate ?? '').trim()) errors.push('missing license_plate')

  const rt = Number(row.reason_type)
  const reasonType = (rt === 1 || rt === 2 || rt === 3 || rt === 4 ? rt : null) as ReasonType | null
  if (reasonType === null) {
    errors.push(`invalid reason_type "${row.reason_type}"`)
    return { reasonType, errors }
  }
  if ((reasonType === 1 || reasonType === 2) && !(row.impaired_person_name ?? '').trim()) {
    errors.push('reason_type 1/2 requires impaired_person_name')
  }
  if (reasonType === 4) {
    if (!(row.elder_1_name ?? '').trim()) errors.push('reason_type 4 requires elder_1_name')
    if (!parseFormDate(row.elder_1_birthdate)) errors.push('reason_type 4 requires a valid elder_1_birthdate')
  }
  if (reasonType === 3 && !isPregnancy(row.remarks) && !(row.child_1_name ?? '').trim()) {
    errors.push('reason_type 3 requires child_1_name or a pregnancy remark')
  }
  return { reasonType, errors }
}
