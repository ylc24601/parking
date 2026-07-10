import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Phase 6 — member import end-to-end (synthetic CSV → users/vehicles/eligibility/dependents)
// against local Supabase. Gated: `RUN_DB_TESTS=1` + reachable local DB (prereq: `npm run db:reset`).
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

type Sb = import('@supabase/supabase-js').SupabaseClient

const FIXTURE = fileURLToPath(new URL('../fixtures/members-sample.csv', import.meta.url))
const PHONES = ['0955000001', '0955000002', '0955000003', '0955000004', '0955000005', '0955000008', '0955000009']

describe.skipIf(!RUN)('member import (Phase 6) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let importMembersFromCsv: typeof import('@/server/services/memberImportService').importMembersFromCsv

  const userByPhone = async (phone: string) =>
    (await sb.from('users').select('id, display_name').eq('phone_number', phone).maybeSingle()).data as { id: string; display_name: string } | null
  const eligibilityOf = async (userId: string) =>
    (await sb.from('user_eligibility').select('*').eq('user_id', userId).single()).data!
  const vehiclesOf = async (userId: string) =>
    (await sb.from('vehicles').select('license_plate_normalized').eq('user_id', userId)).data as Array<{ license_plate_normalized: string }>
  const dependentsOf = async (userId: string) =>
    (await sb.from('eligibility_dependents').select('dependent_kind, dependent_name').eq('user_id', userId)).data as Array<{ dependent_kind: string; dependent_name: string }>

  const cleanup = async () => {
    const { data: us } = await sb.from('users').select('id').in('phone_number', PHONES)
    for (const u of (us ?? []) as Array<{ id: string }>) {
      await sb.from('vehicles').delete().eq('user_id', u.id) // vehicles have no ON DELETE CASCADE
    }
    await sb.from('users').delete().in('phone_number', PHONES) // cascades eligibility + dependents
  }

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    importMembersFromCsv = (await import('@/server/services/memberImportService')).importMembersFromCsv
    await cleanup()
  })

  afterAll(async () => {
    if (!RUN) return
    await cleanup()
  })

  it('dry-run projects but writes nothing', async () => {
    const report = await importMembersFromCsv({ filePath: FIXTURE, dryRun: true }, repo)
    expect(report.members).toBe(7)                          // 7 distinct phones (2 rows for 04 and 08 collapse)
    expect(report.phoneNameConflicts).toHaveLength(1)       // phone …08, two names
    expect(report.validationErrors).toHaveLength(0)
    // nothing written
    for (const p of PHONES) expect(await userByPhone(p)).toBeNull()
  })

  it('apply writes members/vehicles/eligibility/dependents and reports conflicts', async () => {
    const report = await importMembersFromCsv({ filePath: FIXTURE, dryRun: false }, repo)
    expect(report).toMatchObject({
      members: 7, imported: 6, updated: 0, vehiclesAdded: 6, dependentsAdded: 6,
    })
    expect(report.phoneNameConflicts).toHaveLength(1)       // …08 different names → skipped
    expect(report.plateConflicts).toHaveLength(1)           // …09 reused …01's plate
    expect(report.reviewRequired).toHaveLength(0)

    // mobility_short window = application_date + 6 months
    const m2 = (await userByPhone('0955000002'))!
    expect(await eligibilityOf(m2.id)).toMatchObject({ p2_eligible: true, p2_reason: 'mobility_short', p2_valid_until: '2026-08-10' })

    // child_companion: one member, TWO vehicles, valid_until = max(child birthdate)+5y, 2 dependents
    const m4 = (await userByPhone('0955000004'))!
    expect((await vehiclesOf(m4.id)).map(v => v.license_plate_normalized).sort()).toEqual(['TEST4004', 'TEST4040'])
    expect(await eligibilityOf(m4.id)).toMatchObject({ p2_reason: 'child_companion', p2_valid_until: '2029-08-15' })
    expect((await dependentsOf(m4.id)).filter(d => d.dependent_kind === 'child')).toHaveLength(2)

    // pregnancy: 6-month window, no dependents
    const m5 = (await userByPhone('0955000005'))!
    expect(await eligibilityOf(m5.id)).toMatchObject({ p2_reason: 'pregnancy', p2_valid_until: '2026-11-01' })
    expect(await dependentsOf(m5.id)).toHaveLength(0)

    // mobility_long is permanent
    const m1 = (await userByPhone('0955000001'))!
    expect(await eligibilityOf(m1.id)).toMatchObject({ p2_reason: 'mobility_long', p2_valid_until: null })

    // phone-name conflict member was NOT created
    expect(await userByPhone('0955000008')).toBeNull()

    // plate-conflict member exists but did NOT steal the plate (still owned by …01)
    const m7 = (await userByPhone('0955000009'))!
    expect(m7.display_name).toBe('測試庚')
    expect(await vehiclesOf(m7.id)).toHaveLength(0)
    const plateOwner = (await sb.from('vehicles').select('user_id').eq('license_plate_normalized', 'TEST1001').single()).data as { user_id: string }
    expect(plateOwner.user_id).toBe(m1.id)
  })

  it('re-apply is idempotent: 0 new users/vehicles/dependents', async () => {
    const report = await importMembersFromCsv({ filePath: FIXTURE, dryRun: false }, repo)
    expect(report).toMatchObject({ imported: 0, updated: 6, vehiclesAdded: 0, dependentsAdded: 0 })
    expect(report.phoneNameConflicts).toHaveLength(1)
    expect(report.plateConflicts).toHaveLength(1)
  })
})
