import { describe, expect, it, vi } from 'vitest'
import { runFridayAllocation } from '@/server/services/fridayAllocationService'
import { buildReleaseDeadlines } from '@/lib/allocation/release'
import type {
  ApplyResult,
  CapacityInputs,
  OutboxRow,
  ParkingRepository,
  ReservationUpdate,
  WeeklyEventRow,
} from '@/server/repositories/parkingRepository'
import type { ReservationForAllocation } from '@/lib/types'
import { makeReservation } from '../allocation/helpers'

const SUNDAY = '2026-06-21'
const EVENT_ID = 'event-1'

function makeRepo(opts: {
  capacity: Partial<CapacityInputs>
  pending: ReservationForAllocation[]
  applyResult?: ApplyResult
  applyThrows?: Error
}): {
  repo: ParkingRepository
  applySpy: ReturnType<typeof vi.fn>
  markFailedSpy: ReturnType<typeof vi.fn>
} {
  const applySpy = vi.fn(async (): Promise<ApplyResult> => {
    if (opts.applyThrows) throw opts.applyThrows
    return opts.applyResult ?? { skipped: false, updated: 0, outbox_enqueued: 0 }
  })
  const markFailedSpy = vi.fn(async () => {})

  // Only the methods this Friday-allocation test exercises; cast since the full
  // ParkingRepository surface (cancellation/offer methods) is unused here.
  const repo = {
    getWeeklyEvent: async (): Promise<WeeklyEventRow> =>
      ({ id: EVENT_ID, sunday_date: SUNDAY, status: 'open' }),
    getCapacityInputs: async (): Promise<CapacityInputs> => ({
      weekly_event_id: EVENT_ID,
      total_capacity: 23,
      blocked_spaces: 0,
      admin_reserved: 0,
      active_full_time_staff_reserved: 0,
      ...opts.capacity,
    }),
    getPendingForAllocation: async () => opts.pending,
    applyFridayAllocation: applySpy as ParkingRepository['applyFridayAllocation'],
    markJobFailed: markFailedSpy as ParkingRepository['markJobFailed'],
  } as unknown as ParkingRepository
  return { repo, applySpy, markFailedSpy }
}

// capacity 2: 1 P2 + 2 P3 → P2 + one P3 approved, one P3 waiting.
function pendingMix(): ReservationForAllocation[] {
  return [
    makeReservation({ effective_priority: 2 }),                  // P2
    makeReservation({ effective_priority: 3, applied_at: new Date('2026-06-15T01:00:00Z') }),
    makeReservation({ effective_priority: 3, applied_at: new Date('2026-06-15T02:00:00Z') }),
  ]
}

describe('runFridayAllocation (mocked repo)', () => {
  it('approves up to capacity, sets allocation_order 1..N, one outbox per reservation', async () => {
    const pending = pendingMix()
    const { repo, applySpy } = makeRepo({ capacity: { total_capacity: 2 }, pending })

    const summary = await runFridayAllocation({ eventId: EVENT_ID, now: new Date('2026-06-19T10:00:00Z') }, repo)

    expect(summary.plannedApproved).toBe(2)
    expect(summary.plannedWaiting).toBe(1)

    const [, , updates, outbox] = applySpy.mock.calls[0] as [string, string, ReservationUpdate[], OutboxRow[]]
    const approved = updates.filter(u => u.status === 'approved')
    const waiting = updates.filter(u => u.status === 'waiting')
    expect(approved).toHaveLength(2)
    expect(waiting).toHaveLength(1)
    expect([...updates].map(u => u.allocation_order).sort()).toEqual([1, 2, 3])

    // one outbox entry per reservation, all with the friday_allocation dedupe key
    expect(outbox).toHaveLength(3)
    expect(outbox.every(o => o.dedupe_key === `friday_allocation:${o.reservation_id}`)).toBe(true)
  })

  it('stamps release_deadline_at: P2 approved → 10:45, P3 approved → 10:30, waiting → null', async () => {
    const pending = pendingMix()
    const { repo, applySpy } = makeRepo({ capacity: { total_capacity: 2 }, pending })
    await runFridayAllocation({ eventId: EVENT_ID }, repo)

    const [, , updates] = applySpy.mock.calls[0] as [string, string, ReservationUpdate[], OutboxRow[]]
    const priorityById = new Map(pending.map(p => [p.id, p.effective_priority]))
    const deadlines = buildReleaseDeadlines(SUNDAY)

    for (const u of updates) {
      if (u.status === 'waiting') {
        expect(u.release_deadline_at).toBeNull()
      } else if (priorityById.get(u.id) === 2) {
        expect(u.release_deadline_at).toBe(deadlines.p2.toISOString())
      } else {
        expect(u.release_deadline_at).toBe(deadlines.p3.toISOString())
      }
    }
  })

  it('returns jobStatus=skipped when the RPC reports skipped (second run)', async () => {
    const { repo } = makeRepo({
      capacity: { total_capacity: 2 },
      pending: pendingMix(),
      applyResult: { skipped: true },
    })
    const summary = await runFridayAllocation({ eventId: EVENT_ID }, repo)
    expect(summary.jobStatus).toBe('skipped')
  })

  it('records a failed job (upsert) and rethrows when the RPC throws', async () => {
    const boom = new Error('rpc exploded')
    const { repo, markFailedSpy } = makeRepo({
      capacity: { total_capacity: 2 },
      pending: pendingMix(),
      applyThrows: boom,
    })
    await expect(runFridayAllocation({ eventId: EVENT_ID }, repo)).rejects.toThrow('rpc exploded')
    expect(markFailedSpy).toHaveBeenCalledOnce()
    expect(markFailedSpy.mock.calls[0][0]).toBe(EVENT_ID)
    expect(markFailedSpy.mock.calls[0][1]).toBe('friday_allocation')
  })
})
