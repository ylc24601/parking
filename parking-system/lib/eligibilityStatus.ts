// ── P2 eligibility status helpers (Phase 8 Slice 4) ──────────────────────────
// Pure, IO-free date logic shared by the eligibility review LIST (service) and the
// member DETAIL badge (page). All dates are 'YYYY-MM-DD' calendar strings in Taipei
// (lexicographic order == chronological order); "today" comes from taipeiToday(now).

export type EligibilityStatus = 'expired' | 'review_due' | 'active' | 'permanent'

// The earlier of the given non-null ISO dates, or null when all are null. The review
// list sorts and classifies by this: the date the member actually needs attention is
// whichever comes FIRST, not review_date by preference. Import usually writes
// review_date == valid_until for temporary eligibility, but that is a convention, not
// a DB constraint — legacy / manually-corrected rows may differ, so we never assume it.
export function earliestDate(...dates: Array<string | null>): string | null {
  const present = dates.filter((d): d is string => d !== null)
  if (present.length === 0) return null
  return present.reduce((min, d) => (d < min ? d : min))
}

// Add whole calendar days to a 'YYYY-MM-DD' date via UTC calendar arithmetic (handles
// month/year/leap-year rollover). Taipei has no DST, so date-only math is unambiguous.
export function addDaysToIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return d.toISOString().slice(0, 10)
}

// Status of a single eligibility, for the detail-page badge. Precedence matters:
// an already-expired qualification (valid_until in the past) is 'expired' even if a
// later review_date exists. `today` must be a Taipei calendar date.
//   valid_until < today       → 'expired'  (silently falls back to P3 at apply time)
//   review_date <= today      → 'review_due'
//   both dates null           → 'permanent'
//   otherwise (future due)    → 'active'
export function deriveEligibilityStatus(
  e: { validUntil: string | null; reviewDate: string | null },
  today: string,
): EligibilityStatus {
  if (e.validUntil !== null && e.validUntil < today) return 'expired'
  if (e.reviewDate !== null && e.reviewDate <= today) return 'review_due'
  if (e.validUntil === null && e.reviewDate === null) return 'permanent'
  return 'active'
}
