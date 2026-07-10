import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Phase 7 Slice 3 — member apply (apply_reservation RPC + §4 priority) and self-cancel
// (wrapping the real cancellation service → apply_cancellation RPC) against local Supabase.
// Gated: `RUN_DB_TESTS=1` + reachable local Supabase (prereq: `npm run db:reset`).
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

type Sb = import('@supabase/supabase-js').SupabaseClient

// This file owns Sundays 2099-04-19 / 2099-04-26. "now" is the Thursday before.
const SUNDAY_1 = '2099-04-19'
const SUNDAY_2 = '2099-04-26'
const NOW = new Date('2099-04-16T00:00:00Z')
const T = randomUUID().slice(0, 8).toUpperCase()

describe.skipIf(!RUN)('member apply/cancel (Phase 7 Slice 3) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let svc: typeof import('@/server/services/memberReservationService')

  const eventId1 = randomUUID()
  const eventId2 = randomUUID()
  const users: string[] = []
  const phoneBase = 96000000 + randomInt(1000000)

  const mkMember = async (opts: {
    role?: string
    reason?: string | null
    validUntil?: string | null
    vehicle?: boolean
  } = {}) => {
    const id = randomUUID()
    await sb.from('users').insert({
      id, display_name: `Res7C ${T} ${users.length}`, role: opts.role ?? 'user',
      phone_number: `09${phoneBase + users.length}`,
    }).throwOnError()
    users.push(id)
    let vehicleId: string | null = null
    if (opts.vehicle !== false) {
      vehicleId = randomUUID()
      await sb.from('vehicles')
        .insert({ id: vehicleId, user_id: id, license_plate: `R7C-${T.slice(0, 3)}${users.length}` })
        .throwOnError()
    }
    if (opts.reason) {
      await sb.from('user_eligibility').insert({
        user_id: id, p2_eligible: true, p2_reason: opts.reason, p2_valid_until: opts.validUntil ?? null,
      }).throwOnError()
    }
    return { id, vehicleId: vehicleId! }
  }

  const ownRow = async (userId: string, eventId = eventId1) =>
    (await sb.from('reservations').select('*').eq('weekly_event_id', eventId).eq('user_id', userId)
      .not('status', 'in', '("cancelled_by_user","cancelled_late")').maybeSingle()).data

  const apply = (userId: string, vehicleId: string, requestedP2 = false) =>
    svc.applyForWeek({ userId, vehicleId, requestedP2 }, repo, NOW)
  const cancel = (userId: string) => svc.cancelForWeek({ userId }, repo, NOW)

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    svc = await import('@/server/services/memberReservationService')

    await sb.from('weekly_events').insert([
      { id: eventId1, sunday_date: SUNDAY_1, total_capacity: 23, status: 'open' },
      { id: eventId2, sunday_date: SUNDAY_2, total_capacity: 23, status: 'open' },
    ]).throwOnError()
  })

  afterAll(async () => {
    if (!RUN) return
    await sb.from('notification_outbox').delete().in('weekly_event_id', [eventId1, eventId2])
    await sb.from('reservations').delete().in('weekly_event_id', [eventId1, eventId2])
    await sb.from('job_runs').delete().in('weekly_event_id', [eventId1, eventId2])
    await sb.from('weekly_events').delete().in('id', [eventId1, eventId2])
    for (const id of users) {
      await sb.from('vehicles').delete().eq('user_id', id)
      await sb.from('user_eligibility').delete().eq('user_id', id)
      await sb.from('users').delete().eq('id', id)
    }
  })

  it('P3 apply: pending row with priority 3, the chosen vehicle, applied_at = now', async () => {
    const m = await mkMember()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: true })
    const row = await ownRow(m.id)
    expect(row).toMatchObject({
      status: 'pending', effective_priority: 3, vehicle_id: m.vehicleId,
      requested_p2_this_week: false, user_id: m.id,
    })
    expect(new Date(row!.applied_at as string).toISOString()).toBe(NOW.toISOString())
  })

  it('auto-P2 (mobility_long): priority 2 without any declaration', async () => {
    const m = await mkMember({ reason: 'mobility_long' })
    expect(await apply(m.id, m.vehicleId, false)).toEqual({ ok: true })
    expect((await ownRow(m.id))!.effective_priority).toBe(2)
  })

  it('companion (child): declared → 2, undeclared → 3; expired pregnancy → 3', async () => {
    const declared = await mkMember({ reason: 'child_companion', validUntil: '2099-12-31' })
    expect(await apply(declared.id, declared.vehicleId, true)).toEqual({ ok: true })
    expect((await ownRow(declared.id))!.effective_priority).toBe(2)
    expect((await ownRow(declared.id))!.requested_p2_this_week).toBe(true)

    const undeclared = await mkMember({ reason: 'elderly_companion' })
    expect(await apply(undeclared.id, undeclared.vehicleId, false)).toEqual({ ok: true })
    expect((await ownRow(undeclared.id))!.effective_priority).toBe(3)

    const expired = await mkMember({ reason: 'pregnancy', validUntil: '2099-04-18' })
    expect(await apply(expired.id, expired.vehicleId, false)).toEqual({ ok: true })
    expect((await ownRow(expired.id))!.effective_priority).toBe(3)
  })

  it('guards: duplicate apply / someone else\'s vehicle / full-time staff', async () => {
    const m = await mkMember()
    const other = await mkMember()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: true })
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: false, reason: 'already_applied' })
    expect(await apply(other.id, m.vehicleId)).toEqual({ ok: false, reason: 'vehicle_not_owned' })

    const staff = await mkMember({ role: 'full_time_staff' })
    expect(await apply(staff.id, staff.vehicleId)).toEqual({ ok: false, reason: 'staff_use_p1' })
    expect(await ownRow(staff.id)).toBeNull()
  })

  it('window: allocation job claiming the week closes applications (running AND success)', async () => {
    // The resolver targets SUNDAY_1; mark ITS allocation as claimed and try to apply.
    const m = await mkMember()
    await sb.from('job_runs')
      .insert({ weekly_event_id: eventId1, job_type: 'friday_allocation', status: 'running' })
      .throwOnError()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: false, reason: 'applications_closed' })
    expect(await repo.hasFridayAllocationRun(eventId1)).toBe(true)

    await sb.from('job_runs').update({ status: 'success' }).eq('weekly_event_id', eventId1).throwOnError()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: false, reason: 'applications_closed' })

    // A failed run re-opens the window (the allocator reclaims failed runs).
    await sb.from('job_runs').update({ status: 'failed' }).eq('weekly_event_id', eventId1).throwOnError()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: true })
    await sb.from('job_runs').delete().eq('weekly_event_id', eventId1)
  })

  it('window: a non-open event refuses applications', async () => {
    const m = await mkMember()
    await sb.from('weekly_events').update({ status: 'closed' }).eq('id', eventId1).throwOnError()
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: false, reason: 'event_not_open' })
    await sb.from('weekly_events').update({ status: 'open' }).eq('id', eventId1).throwOnError()
  })

  it('cancel pending → cancelled_by_user; re-cancel is a typed no-op; re-apply allowed', async () => {
    const m = await mkMember()
    await apply(m.id, m.vehicleId)
    expect(await cancel(m.id)).toEqual({ ok: true, cancelStatus: 'cancelled_by_user' })
    expect(await ownRow(m.id)).toBeNull()   // no live row
    expect(await cancel(m.id)).toEqual({ ok: false, reason: 'nothing_to_cancel' })

    // The one-active index excludes cancelled rows → the member may re-apply.
    expect(await apply(m.id, m.vehicleId)).toEqual({ ok: true })
    expect((await ownRow(m.id))!.status).toBe('pending')
  })

  it('cancel approved → cancelled_late (spot freed through the shared cancellation RPC)', async () => {
    const m = await mkMember()
    await apply(m.id, m.vehicleId)
    await sb.from('reservations')
      .update({ status: 'approved', approved_at: NOW.toISOString(), release_deadline_at: `${SUNDAY_1}T02:30:00Z` })
      .eq('weekly_event_id', eventId1).eq('user_id', m.id).throwOnError()

    expect(await cancel(m.id)).toEqual({ ok: true, cancelStatus: 'cancelled_late' })
    const row = (await sb.from('reservations').select('status, cancelled_at')
      .eq('weekly_event_id', eventId1).eq('user_id', m.id).single()).data!
    expect(row.status).toBe('cancelled_late')
    expect(row.cancelled_at).not.toBeNull()
  })

  it('temp_approved → offer_in_progress (row untouched)', async () => {
    const m = await mkMember()
    await apply(m.id, m.vehicleId)
    await sb.from('reservations')
      .update({ status: 'temp_approved', offer_expires_at: `${SUNDAY_1}T00:00:00Z` })
      .eq('weekly_event_id', eventId1).eq('user_id', m.id).throwOnError()
    expect(await cancel(m.id)).toEqual({ ok: false, reason: 'offer_in_progress' })
    expect((await ownRow(m.id))!.status).toBe('temp_approved')
  })
})
