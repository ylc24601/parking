import { describe, expect, it } from 'vitest'
import { taipeiToday, upcomingSundayISO } from '@/lib/taipeiDate'

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

// Phase 9 Slice 1 — the Sunday scheduled jobs target: smallest Taipei-calendar
// Sunday >= today. 2026-06-21 and 2026-07-19 are Sundays.
describe('upcomingSundayISO', () => {
  it('Sunday itself counts as the upcoming Sunday all day (Taipei)', () => {
    // Taipei Sunday 00:00 = Saturday 16:00Z
    expect(upcomingSundayISO(new Date('2026-06-20T16:00:00Z'))).toBe('2026-06-21')
    // Taipei Sunday 23:59 = Sunday 15:59Z
    expect(upcomingSundayISO(new Date('2026-06-21T15:59:00Z'))).toBe('2026-06-21')
  })

  it('rolls to next week exactly at Taipei Monday 00:00 (Sunday 16:00Z)', () => {
    expect(upcomingSundayISO(new Date('2026-06-21T16:00:00Z'))).toBe('2026-06-28')
  })

  it('uses the Taipei calendar day, not the UTC one', () => {
    // UTC Saturday 2026-06-20 20:00Z is already Taipei Sunday 06-21 04:00.
    expect(upcomingSundayISO(new Date('2026-06-20T20:00:00Z'))).toBe('2026-06-21')
  })

  it('mid-week points at this week\'s Sunday', () => {
    // Taipei Monday 2026-07-13 00:00 (= 07-12T16:00Z) through the week → 07-19.
    expect(upcomingSundayISO(new Date('2026-07-12T16:00:00Z'))).toBe('2026-07-19')
    expect(upcomingSundayISO(new Date('2026-07-15T04:00:00Z'))).toBe('2026-07-19')
  })

  it('crosses month and year boundaries', () => {
    // Taipei Tue 2026-07-28 → Sunday 2026-08-02.
    expect(upcomingSundayISO(new Date('2026-07-28T04:00:00Z'))).toBe('2026-08-02')
    // Taipei Tue 2026-12-29 → Sunday 2027-01-03.
    expect(upcomingSundayISO(new Date('2026-12-29T04:00:00Z'))).toBe('2027-01-03')
  })
})
