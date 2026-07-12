import { describe, expect, it } from 'vitest'
import { addDaysToIsoDate, deriveEligibilityStatus, earliestDate } from '@/lib/eligibilityStatus'

describe('earliestDate', () => {
  it('returns the earlier of two dates regardless of argument order', () => {
    expect(earliestDate('2026-07-15', '2026-08-30')).toBe('2026-07-15')
    expect(earliestDate('2026-08-30', '2026-07-15')).toBe('2026-07-15')
  })

  it('ignores nulls; returns the single present date', () => {
    expect(earliestDate(null, '2026-07-15')).toBe('2026-07-15')
    expect(earliestDate('2026-07-15', null)).toBe('2026-07-15')
  })

  it('returns null when all inputs are null', () => {
    expect(earliestDate(null, null)).toBeNull()
  })
})

describe('addDaysToIsoDate', () => {
  it('+0 returns the same day (cutoff is inclusive of the current day)', () => {
    expect(addDaysToIsoDate('2026-07-12', 0)).toBe('2026-07-12')
  })

  it('rolls over a month boundary', () => {
    expect(addDaysToIsoDate('2026-07-15', 60)).toBe('2026-09-13')
  })

  it('rolls over a year boundary', () => {
    expect(addDaysToIsoDate('2026-12-01', 60)).toBe('2027-01-30')
  })

  it('handles a leap-year February (2028 is a leap year)', () => {
    expect(addDaysToIsoDate('2028-01-30', 30)).toBe('2028-02-29')
    expect(addDaysToIsoDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('handles a non-leap February', () => {
    expect(addDaysToIsoDate('2027-02-28', 1)).toBe('2027-03-01')
  })
})

describe('deriveEligibilityStatus', () => {
  const today = '2026-07-12'

  it('valid_until in the past → expired (even if a later review_date exists)', () => {
    expect(deriveEligibilityStatus({ validUntil: '2026-07-11', reviewDate: '2026-08-30' }, today)).toBe('expired')
  })

  it('valid_until == today is NOT yet expired (same-day still valid, matches priority.ts)', () => {
    expect(deriveEligibilityStatus({ validUntil: today, reviewDate: null }, today)).toBe('active')
  })

  it('review_date at/before today (not expired) → review_due', () => {
    expect(deriveEligibilityStatus({ validUntil: null, reviewDate: '2026-07-11' }, today)).toBe('review_due')
    expect(deriveEligibilityStatus({ validUntil: null, reviewDate: today }, today)).toBe('review_due')
  })

  it('both dates null → permanent', () => {
    expect(deriveEligibilityStatus({ validUntil: null, reviewDate: null }, today)).toBe('permanent')
  })

  it('a future due date → active', () => {
    expect(deriveEligibilityStatus({ validUntil: '2026-09-01', reviewDate: '2026-09-01' }, today)).toBe('active')
  })
})
