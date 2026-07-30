import type { WeekStage } from '@/lib/weekStage'

// ── This week's DEMAND side of the admin overview (Wave 3 / #32) ──────────────
// Pure, IO-free. Turns raw reservation rows into the counts the dashboard shows
// next to capacity. Lives here rather than inside the repository so the aggregation
// itself is testable against RAW rows — the property that matters most (that a P2
// count reads a frozen column and nothing else) is invisible once a repo method has
// already reduced the rows to numbers.
//
// ── effective_priority is FROZEN AT APPLY TIME, and must stay that way ────────
// The Friday allocator sorts on this very column (lib/allocation/sort.ts), so the
// overview's 「優先 N 位」 is exactly the set the allocator will treat as P2. A member
// whose eligibility is revoked AFTER applying still counts as P2 here — matching the
// allocation outcome. Deriving priority from users/eligibility instead would produce a
// second truth ("overview says 4, allocator says 3"), so this module deliberately takes
// nothing but the reservation row.

// The statuses that make up "this week's live demand + promised seats". Exported so the
// repository's .in('status', …) filter and the counter below cannot drift apart.
// Terminal states (attended / no_show / cancelled_* / walk_in) are after-the-fact
// analysis (#16), not "is there anything to handle right now".
export const WEEK_DEMAND_STATUSES = ['pending', 'waiting', 'approved', 'temp_approved'] as const

export interface WeekReservationRow {
  status: string
  effective_priority: number
}

export interface PriorityCounts {
  total: number
  p2: number   // effective_priority === 2, exactly
  p3: number   // effective_priority === 3, exactly
}

export interface WeekReservationCounts {
  promised: number          // approved + temp_approved — same set as countPromisedReservations
  pending: PriorityCounts
  waiting: PriorityCounts
}

const emptyCounts = (): PriorityCounts => ({ total: 0, p2: 0, p3: 0 })

// p2 is EXACTLY 2 — never `<= 2`. staff_checkin_view exposes `is_priority` (P1 OR P2,
// reason hidden) and that is a different question: a field named p2 that also counts P1
// would be renaming bad data rather than reporting it. P1 cannot reach a reservation
// through any current path (full-time staff seats live in weekly_staff_allocations, see
// lib/allocation/priority.ts; walk-ins are hard-coded to 3), so a P1 row here is an
// invariant violation and fails loudly. Consequence, accepted deliberately: it takes the
// /admin overview down rather than quietly under-reporting — the same posture the rest of
// this metric already has (a repo read failure throws too). The message carries no row data.
function bump(counts: PriorityCounts, priority: number): void {
  counts.total += 1
  if (priority === 2) {
    counts.p2 += 1
    return
  }
  if (priority === 3) {
    counts.p3 += 1
    return
  }
  throw new Error(
    `summarizeWeekReservations: unexpected effective_priority ${priority} on an application reservation`,
  )
}

export function summarizeWeekReservations(rows: WeekReservationRow[]): WeekReservationCounts {
  const counts: WeekReservationCounts = { promised: 0, pending: emptyCounts(), waiting: emptyCounts() }

  for (const row of rows) {
    switch (row.status) {
      case 'pending':
        bump(counts.pending, row.effective_priority)
        break
      case 'waiting':
        bump(counts.waiting, row.effective_priority)
        break
      case 'approved':
      case 'temp_approved':
        // temp_approved is a HELD seat, not a pending one (0006:26-36) — same set the
        // capacity page calls "已核准", so the two pages cannot disagree.
        counts.promised += 1
        break
      default:
        // Defensive: the query filters to WEEK_DEMAND_STATUSES, so anything else is a
        // caller passing unfiltered rows. Ignore rather than throw — a terminal row is
        // not corrupt data, it simply isn't demand.
        break
    }
  }

  return counts
}

// Should the 「申請中」 number be called out? After allocation runs, pending rows are
// expected to have become approved/waiting, so a non-zero count is worth a second look.
//
// NOT proof of a mistake: hasFridayAllocationRun counts job_runs rows in status
// 'running' as well as 'success' (parkingRepository), and the Friday job claims the run
// BEFORE it reads and allocates the pending rows — so `allocated` + pending > 0 legitimately
// occurs for the duration of a run. That window is short, and a genuinely stuck 'running'
// job is exactly the case an operator wants surfaced, so this stays as-is. Copy must say
// "needs attention", never "you missed some".
export function pendingNeedsAttention(stage: WeekStage, pending: number): boolean {
  if (pending <= 0) return false
  return stage !== 'application_open' && stage !== 'no_event'
}
