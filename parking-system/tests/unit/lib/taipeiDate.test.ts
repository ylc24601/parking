import { describe, expect, it } from 'vitest'
import { taipeiToday } from '@/lib/taipeiDate'

// Asia/Taipei is UTC+8 year-round (no DST): the member "this week" resolver keys
// off the Taipei calendar date, so the UTC-day boundary must flip at 16:00Z.
describe('taipeiToday', () => {
  it('is the UTC date while both calendars agree', () => {
    expect(taipeiToday(new Date('2026-07-10T00:00:00Z'))).toBe('2026-07-10')
    expect(taipeiToday(new Date('2026-07-10T15:59:59Z'))).toBe('2026-07-10')
  })

  it('rolls to the next Taipei day at 16:00Z', () => {
    expect(taipeiToday(new Date('2026-07-10T16:00:00Z'))).toBe('2026-07-11')
  })

  it('Sunday stays "today" in Taipei through Saturday 16:00Z → Sunday 15:59Z', () => {
    // 2026-06-21 is a Sunday. Taipei Sunday 00:00 = Saturday 16:00Z.
    expect(taipeiToday(new Date('2026-06-20T16:00:00Z'))).toBe('2026-06-21')
    // Taipei Sunday 23:59 = Sunday 15:59Z — the event must still resolve to 06-21.
    expect(taipeiToday(new Date('2026-06-21T15:59:00Z'))).toBe('2026-06-21')
    // Taipei Monday 00:00 → next week.
    expect(taipeiToday(new Date('2026-06-21T16:00:00Z'))).toBe('2026-06-22')
  })

  it('crosses month and year boundaries in Taipei time', () => {
    expect(taipeiToday(new Date('2026-06-30T17:00:00Z'))).toBe('2026-07-01')
    expect(taipeiToday(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01')
  })
})
