import { describe, expect, it } from 'vitest'
import {
  WEEK_DEMAND_STATUSES,
  pendingNeedsAttention,
  summarizeWeekReservations,
  type WeekReservationRow,
} from '@/lib/weekDemand'
import type { WeekStage } from '@/lib/weekStage'

const row = (status: string, effective_priority: number): WeekReservationRow => ({
  status,
  effective_priority,
})

describe('summarizeWeekReservations', () => {
  it('splits pending and waiting by frozen effective_priority', () => {
    const counts = summarizeWeekReservations([
      row('pending', 2),
      row('pending', 3),
      row('pending', 3),
      row('waiting', 2),
      row('waiting', 3),
    ])
    expect(counts.pending).toEqual({ total: 3, p2: 1, p3: 2 })
    expect(counts.waiting).toEqual({ total: 2, p2: 1, p3: 1 })
  })

  it('counts approved + temp_approved as promised (temp_approved is a held seat)', () => {
    const counts = summarizeWeekReservations([
      row('approved', 2),
      row('approved', 3),
      row('temp_approved', 3),
    ])
    expect(counts.promised).toBe(3)
    expect(counts.pending.total).toBe(0)
    expect(counts.waiting.total).toBe(0)
  })

  // The whole point of reading the reservation's frozen column: a member whose P2
  // eligibility was revoked AFTER applying still counts as P2, because that is what the
  // Friday allocator will sort on. This function takes nothing but reservation rows —
  // there is no eligibility input it COULD consult — which is the property being pinned.
  it('counts a pending row as P2 from the frozen value alone, with no eligibility input', () => {
    const counts = summarizeWeekReservations([row('pending', 2)])
    expect(counts.pending).toEqual({ total: 1, p2: 1, p3: 0 })
  })

  it('keeps p2 + p3 === total', () => {
    const counts = summarizeWeekReservations([
      row('pending', 2),
      row('pending', 2),
      row('pending', 3),
      row('waiting', 3),
    ])
    for (const bucket of [counts.pending, counts.waiting]) {
      expect(bucket.p2 + bucket.p3).toBe(bucket.total)
    }
  })

  it('ignores terminal statuses instead of counting them as demand', () => {
    const counts = summarizeWeekReservations([
      row('pending', 2),
      row('attended', 2),
      row('no_show', 3),
      row('cancelled_by_user', 3),
      row('cancelled_late', 3),
      row('released_late', 2),
      row('attended_after_release', 3),
      row('walk_in', 3),
    ])
    expect(counts).toEqual({
      promised: 0,
      pending: { total: 1, p2: 1, p3: 0 },
      waiting: { total: 0, p2: 0, p3: 0 },
    })
  })

  // P1 never reaches a reservation through any current path (staff seats live in
  // weekly_staff_allocations; walk-ins are hard-coded to 3), so it is an invariant
  // violation — not something to quietly fold into "優先".
  it('throws on a P1 application row rather than counting it as P2', () => {
    expect(() => summarizeWeekReservations([row('pending', 1)])).toThrow(/effective_priority 1/)
  })

  it('throws on an out-of-range priority', () => {
    expect(() => summarizeWeekReservations([row('waiting', 4)])).toThrow(/effective_priority 4/)
  })

  it('exports exactly the statuses it counts, for the query filter to reuse', () => {
    expect([...WEEK_DEMAND_STATUSES]).toEqual(['pending', 'waiting', 'approved', 'temp_approved'])
  })
})

describe('pendingNeedsAttention', () => {
  const stages: WeekStage[] = ['no_event', 'application_open', 'allocated', 'finalized', 'closed']

  it('never flags a zero count', () => {
    for (const stage of stages) {
      expect(pendingNeedsAttention(stage, 0)).toBe(false)
    }
  })

  it('does not flag pending while applications are still open', () => {
    expect(pendingNeedsAttention('application_open', 12)).toBe(false)
    expect(pendingNeedsAttention('no_event', 12)).toBe(false)
  })

  it('flags pending once the week has moved past taking applications', () => {
    expect(pendingNeedsAttention('allocated', 1)).toBe(true)
    expect(pendingNeedsAttention('finalized', 1)).toBe(true)
    expect(pendingNeedsAttention('closed', 1)).toBe(true)
  })
})
