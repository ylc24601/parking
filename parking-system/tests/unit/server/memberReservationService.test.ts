import { describe, expect, it, vi } from 'vitest'
import { makeMockRepo, asRepo, type MockRepo } from './mockRepo'
import { applyForWeek, cancelForWeek } from '@/server/services/memberReservationService'
import type { cancelReservation } from '@/server/services/cancellationService'

const NOW = new Date('2026-07-09T00:00:00Z')   // Thu before Sunday 2026-07-12 (Taipei)
const USER = 'user-1'
const VEHICLE = '00000000-0000-4000-8000-000000000001'
const EVENT = { id: 'event-1', sunday_date: '2026-07-12', status: 'open' }

const reservationRow = (status: string) => ({
  id: 'res-1', status, license_plate: 'ABC-1234', applied_at: NOW,
  release_deadline_at: null, offer_expires_at: null, p2_on_the_way: false,
})

function run(over: Partial<MockRepo> = {}) {
  const repo = makeMockRepo({ getMemberEvent: vi.fn(async () => EVENT), ...over })
  return { repo, r: asRepo(repo) }
}

describe('applyForWeek', () => {
  it('computes the §4 priority from server-side eligibility and passes it to the RPC', async () => {
    const { repo, r } = run({
      getMemberEligibility: vi.fn(async () => ({ p2_eligible: true, p2_reason: 'mobility_long', p2_valid_until: null })),
    })
    expect(await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: false }, r, NOW)).toEqual({ ok: true })
    expect(repo.applyReservation).toHaveBeenCalledWith({
      eventId: 'event-1',
      userId: USER,
      vehicleId: VEHICLE,
      requestedP2: false,
      effectivePriority: 2,        // auto-P2, no declaration needed
      nowIso: NOW.toISOString(),
    })
  })

  it('a plain member lands at P3; a declared companion at P2', async () => {
    const { repo, r } = run({
      getMemberEligibility: vi.fn(async () => ({ p2_eligible: true, p2_reason: 'child_companion', p2_valid_until: null })),
    })
    await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: true }, r, NOW)
    expect(repo.applyReservation.mock.calls[0][0].effectivePriority).toBe(2)
    await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: false }, r, NOW)
    expect(repo.applyReservation.mock.calls[1][0].effectivePriority).toBe(3)
  })

  it('full-time staff are steered to P1 (no public application, RPC untouched)', async () => {
    const { repo, r } = run({ getUserRole: vi.fn(async () => 'full_time_staff') })
    expect(await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: false }, r, NOW))
      .toEqual({ ok: false, reason: 'staff_use_p1' })
    expect(repo.applyReservation).not.toHaveBeenCalled()
  })

  it('no upcoming week → no_open_week', async () => {
    const { r } = run({ getMemberEvent: vi.fn(async () => null) })
    expect(await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: false }, r, NOW))
      .toEqual({ ok: false, reason: 'no_open_week' })
  })

  it('malformed vehicle id → invalid_request before any read', async () => {
    const { repo, r } = run()
    for (const bad of [undefined, 42, 'not-a-uuid', '']) {
      expect(await applyForWeek({ userId: USER, vehicleId: bad, requestedP2: false }, r, NOW))
        .toEqual({ ok: false, reason: 'invalid_request' })
    }
    expect(repo.getMemberEvent).not.toHaveBeenCalled()
  })

  it('RPC business rejections pass through typed', async () => {
    const { r } = run({ applyReservation: vi.fn(async () => ({ applied: 0, reason: 'already_applied' })) })
    expect(await applyForWeek({ userId: USER, vehicleId: VEHICLE, requestedP2: false }, r, NOW))
      .toEqual({ ok: false, reason: 'already_applied' })
  })
})

describe('cancelForWeek', () => {
  const cancelFn = (summary: { cancelled: boolean; cancelStatus: 'cancelled_by_user' | 'cancelled_late' }) =>
    vi.fn(async () => ({
      ...summary, substituteOffered: false, substituteReservationId: null, confirmationEnqueued: true,
    })) as unknown as typeof cancelReservation

  it('cancels the member\'s own live row via the shared cancellation service', async () => {
    const { r } = run({ getMemberWeekReservation: vi.fn(async () => reservationRow('pending')) })
    const fn = cancelFn({ cancelled: true, cancelStatus: 'cancelled_by_user' })
    expect(await cancelForWeek({ userId: USER }, r, NOW, fn)).toEqual({ ok: true, cancelStatus: 'cancelled_by_user' })
    expect(fn).toHaveBeenCalledWith({ reservationId: 'res-1', now: NOW }, r)
  })

  it('approved → cancelled_late result surfaces', async () => {
    const { r } = run({ getMemberWeekReservation: vi.fn(async () => reservationRow('approved')) })
    const fn = cancelFn({ cancelled: true, cancelStatus: 'cancelled_late' })
    expect(await cancelForWeek({ userId: USER }, r, NOW, fn)).toEqual({ ok: true, cancelStatus: 'cancelled_late' })
  })

  it('temp_approved → offer_in_progress (offer flow owns it, service untouched)', async () => {
    const { r } = run({ getMemberWeekReservation: vi.fn(async () => reservationRow('temp_approved')) })
    const fn = cancelFn({ cancelled: true, cancelStatus: 'cancelled_by_user' })
    expect(await cancelForWeek({ userId: USER }, r, NOW, fn)).toEqual({ ok: false, reason: 'offer_in_progress' })
    expect(fn).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'nothing_to_cancel'],
    [reservationRow('cancelled_by_user'), 'nothing_to_cancel'],
    [reservationRow('attended'), 'cannot_cancel'],
    [reservationRow('released_late'), 'cannot_cancel'],
  ] as const)('row %o → %s', async (row, reason) => {
    const { r } = run({ getMemberWeekReservation: vi.fn(async () => row) })
    const fn = cancelFn({ cancelled: true, cancelStatus: 'cancelled_by_user' })
    expect(await cancelForWeek({ userId: USER }, r, NOW, fn)).toEqual({ ok: false, reason })
    expect(fn).not.toHaveBeenCalled()
  })

  it('no open week → nothing_to_cancel', async () => {
    const { r } = run({ getMemberEvent: vi.fn(async () => null) })
    expect(await cancelForWeek({ userId: USER }, r, NOW)).toEqual({ ok: false, reason: 'nothing_to_cancel' })
  })
})
