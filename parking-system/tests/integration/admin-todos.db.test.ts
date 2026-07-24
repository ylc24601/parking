import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Wave 3 (#9) — countOpenPastoralAlerts through the REAL repository, so the actual
// PostgREST head/count query (not a raw-SQL re-derivation) is what's under test.
// Gated: `RUN_DB_TESTS=1` + local Supabase (prereq: `npm run db:reset`).
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

type Sb = import('@supabase/supabase-js').SupabaseClient

const NOW = new Date('2099-09-06T02:00:00Z')
// Fresh Sunday, no collision with other integration files.
const SUNDAY = '2099-09-06'
const T = randomUUID().slice(0, 8)

// The count is table-global, so assert DELTAS against a baseline measured at the start —
// robust to any rows left by earlier (serial) suites. fileParallelism:false guarantees
// nothing else mutates the table during this file.
describe.skipIf(!RUN)('countOpenPastoralAlerts (Wave 3 #9) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  const eventId = randomUUID()
  const adminId = randomUUID()
  const createdUsers: string[] = []

  const mkUser = async (name: string): Promise<string> => {
    const id = randomUUID()
    await sb.from('users').insert({ id, display_name: name }).throwOnError()
    createdUsers.push(id)
    return id
  }
  const mkOpenAlert = async (userId: string): Promise<string> => {
    const id = randomUUID()
    await sb.from('pastoral_care_alerts')
      .insert({ id, user_id: userId, weekly_event_id: eventId, reason: 'consecutive_no_show', trigger_count: 4 })
      .throwOnError()
    return id
  }

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    await sb.from('weekly_events')
      .insert({ id: eventId, sunday_date: SUNDAY, total_capacity: 23, blocked_spaces: 0, admin_reserved: 0 })
      .throwOnError()
    await sb.from('admin_accounts')
      .insert({ id: adminId, username: `todos-${T}`, password_hash: 'scrypt$00$00' })
      .throwOnError()
  })

  afterAll(async () => {
    if (!RUN) return
    for (const uid of createdUsers) {
      await sb.from('pastoral_care_alerts').delete().eq('user_id', uid)
      await sb.from('user_penalties').delete().eq('user_id', uid)
      await sb.from('users').delete().eq('id', uid)
    }
    await sb.from('weekly_events').delete().eq('id', eventId)
    await sb.from('admin_accounts').delete().eq('id', adminId)
  })

  it('counts open alerts and excludes resolved ones', async () => {
    const baseline = await repo.countOpenPastoralAlerts()

    // 3 open alerts (one-open-per-user partial unique ⇒ three distinct users).
    const u1 = await mkUser(`測試甲-${T}`)
    const u2 = await mkUser(`測試乙-${T}`)
    const u3 = await mkUser(`測試丙-${T}`)
    const a1 = await mkOpenAlert(u1)
    await mkOpenAlert(u2)
    await mkOpenAlert(u3)

    expect(await repo.countOpenPastoralAlerts()).toBe(baseline + 3)

    // Resolving one drops it from the count; the row still exists (status='resolved').
    const res = await repo.resolvePastoralAlert({
      alertId: a1, adminId, note: null, resetCounter: false, nowIso: NOW.toISOString(),
    })
    expect(res.resolved).toBe(1)
    expect(await repo.countOpenPastoralAlerts()).toBe(baseline + 2)
  })
})
