import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Gated: `RUN_DB_TESTS=1` + reachable local Supabase (prereq: `npm run db:reset`).
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

type Sb = import('@supabase/supabase-js').SupabaseClient

// Fresh Sunday — must not collide with other integration files (…01-xx / 02-01 /
// 03-xx / 04-01). Also the max sunday_date present, so getActiveEvent() resolves it.
const SUNDAY = '2099-05-03'
const PIN = '246810'

describe.skipIf(!RUN)('staff PIN session — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let loginStaff: typeof import('@/server/services/staffSessionService').loginStaff
  let hashPin: typeof import('@/server/http/pinHash').hashPin
  const event = randomUUID()

  async function cascadeDelete(eid: string) {
    await sb.from('staff_sessions').delete().eq('weekly_event_id', eid)
    await sb.from('weekly_events').delete().eq('id', eid)
  }

  async function setPin(expiresAt?: string) {
    await repo.upsertStaffSessionPin({
      eventId: event,
      pinHash: hashPin(PIN),
      expiresAt: expiresAt ?? new Date(Date.now() + 12 * 3600_000).toISOString(),
    })
  }

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    loginStaff = (await import('@/server/services/staffSessionService')).loginStaff
    hashPin = (await import('@/server/http/pinHash')).hashPin

    const { data } = await sb.from('weekly_events').select('id').eq('sunday_date', SUNDAY)
    for (const row of data ?? []) await cascadeDelete(row.id as string)

    await sb
      .from('weekly_events')
      .insert({ id: event, sunday_date: SUNDAY, total_capacity: 23, blocked_spaces: 0, admin_reserved: 0 })
      .throwOnError()
  })

  afterAll(async () => {
    if (RUN) await cascadeDelete(event)
  })

  it('provisions one PIN row per event', async () => {
    await setPin()
    const row = await repo.getStaffSessionByEvent(event)
    expect(row).toBeTruthy()
    expect(row!.weekly_event_id).toBe(event)
    expect(row!.failed_attempts).toBe(0)
    expect(row!.locked_at).toBeNull()
  })

  it('logs in with the correct PIN and binds the session event', async () => {
    await setPin()
    const res = await loginStaff(PIN, repo)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.eventId).toBe(event)
  })

  it('locks the PIN after 5 wrong attempts (atomic counter), blocking even the right PIN', async () => {
    await setPin() // upsert resets failed_attempts / locked_at
    let last
    for (let i = 0; i < 5; i++) last = await loginStaff('000000', repo)
    expect(last).toEqual({ ok: false, reason: 'locked' })

    // Within the cooldown the correct PIN is still refused.
    expect(await loginStaff(PIN, repo)).toEqual({ ok: false, reason: 'locked' })

    const row = await repo.getStaffSessionByEvent(event)
    expect(row!.failed_attempts).toBeGreaterThanOrEqual(5)
    expect(row!.locked_at).not.toBeNull()
  })

  it('treats an expired PIN as invalid (same as a wrong PIN)', async () => {
    await setPin(new Date(Date.now() - 1000).toISOString())
    expect(await loginStaff(PIN, repo)).toEqual({ ok: false, reason: 'invalid' })
  })
})
