import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CsvImportExecutionError } from '@/server/services/memberImportService'

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
const PHONES = ['0955000001', '0955000002', '0955000003', '0955000004', '0955000005', '0955000007', '0955000008', '0955000009']

describe.skipIf(!RUN)('member import (Phase 6) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let importMembersFromCsv: typeof import('@/server/services/memberImportService').importMembersFromCsv
  let importMembersFromCsvText: typeof import('@/server/services/memberImportService').importMembersFromCsvText

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
    ;({ importMembersFromCsv, importMembersFromCsvText } = await import('@/server/services/memberImportService'))
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
      members: 7, imported: 6, updated: 0, vehiclesAdded: 7, dependentsAdded: 6,
    })
    expect(report.phoneNameConflicts).toHaveLength(1)       // …08 different names → skipped
    expect(report.plateConflicts).toHaveLength(0)           // no in-file plate collision in the fixture
    expect(report.batchPlateConflicts).toHaveLength(0)
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

    // …09 is a legitimate elderly member with its own vehicle
    const m7 = (await userByPhone('0955000009'))!
    expect(m7.display_name).toBe('測試庚')
    expect((await vehiclesOf(m7.id)).map(v => v.license_plate_normalized)).toEqual(['TEST9009'])
    expect(await eligibilityOf(m7.id)).toMatchObject({ p2_reason: 'elderly_companion', p2_valid_until: null })
  })

  it('re-apply is idempotent: 0 new users/vehicles/dependents', async () => {
    const report = await importMembersFromCsv({ filePath: FIXTURE, dryRun: false }, repo)
    expect(report).toMatchObject({ imported: 0, updated: 6, vehiclesAdded: 0, dependentsAdded: 0 })
    expect(report.phoneNameConflicts).toHaveLength(1)
    expect(report.plateConflicts).toHaveLength(0)
  })

  it('a plate already owned by another member in the DB is reported as plateConflict (not stolen)', async () => {
    // …01 owns TEST1001 (imported above). A new member claiming it → DB plate_conflict, member kept,
    // vehicle not created, ownership unchanged. (This is the DB-owner path, distinct from a same-file
    // batch collision which the service preflight handles.)
    const csv = 'application_date,applicant_name,license_plate,mobile_phone,reason_type,impaired_person_name\n2026-07-01,測試辛,TEST-1001,0955000007,1,測試辛'
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: false }, repo)
    expect(report.imported).toBe(1)
    expect(report.plateConflicts).toEqual([{ phone: '0955000007', plates: ['TEST1001'] }])
    const m8 = (await userByPhone('0955000007'))!
    expect(await vehiclesOf(m8.id)).toHaveLength(0)
    const owner = (await sb.from('vehicles').select('user_id').eq('license_plate_normalized', 'TEST1001').single()).data as { user_id: string }
    expect(owner.user_id).toBe((await userByPhone('0955000001'))!.id)
  })

  it('the text variant produces the same report as the file-path wrapper (same DB state)', async () => {
    const csvText = readFileSync(FIXTURE, 'utf8')
    const viaText = await importMembersFromCsvText({ csvText, dryRun: true }, repo)
    const viaFile = await importMembersFromCsv({ filePath: FIXTURE, dryRun: true }, repo)
    expect(viaText).toEqual(viaFile)
  })

  it('a mid-apply failure throws typed partial_apply, leaving the members processed so far written', async () => {
    await cleanup()
    const csvText = readFileSync(FIXTURE, 'utf8')

    // Fail the 3rd importMember call; the first two members must already be committed.
    let calls = 0
    const throwingRepo = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'importMember') {
          return async (args: Parameters<typeof target.importMember>[0]) => {
            calls++
            if (calls === 3) throw new Error('simulated DB failure')
            return target.importMember(args)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    let thrown: unknown
    try {
      await importMembersFromCsvText({ csvText, dryRun: false }, throwingRepo)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(CsvImportExecutionError)
    expect((thrown as CsvImportExecutionError).processedMembers).toBe(2)

    // Exactly the two members written before the failure exist.
    const { data: written } = await sb.from('users').select('id').in('phone_number', PHONES)
    expect((written ?? []).length).toBe(2)

    await cleanup()
  })
})

// Wave 0 (#21) — general roster import: P1/P3 write user+vehicles with NO eligibility (import_member
// null-reason path, migration 0029); P2 writes a review-required eligibility; a P1/P3 row NEVER
// revokes an existing member's P2 (retained_p2, works the same in dry-run and apply).
describe.skipIf(!RUN)('roster import (Wave 0 #21) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let importMembersFromCsvText: typeof import('@/server/services/memberImportService').importMembersFromCsvText

  const ROSTER_PHONES = ['0955001001', '0955001002', '0955001003']
  const userByPhone = async (phone: string) =>
    (await sb.from('users').select('id, display_name').eq('phone_number', phone).maybeSingle()).data as { id: string; display_name: string } | null
  const eligRow = async (userId: string) =>
    (await sb.from('user_eligibility').select('*').eq('user_id', userId).maybeSingle()).data as Record<string, unknown> | null
  const vehiclesOf = async (userId: string) =>
    (await sb.from('vehicles').select('license_plate_normalized').eq('user_id', userId)).data as Array<{ license_plate_normalized: string }>

  const cleanup = async () => {
    const { data: us } = await sb.from('users').select('id').in('phone_number', ROSTER_PHONES)
    for (const u of (us ?? []) as Array<{ id: string }>) {
      await sb.from('vehicles').delete().eq('user_id', u.id)
    }
    await sb.from('users').delete().in('phone_number', ROSTER_PHONES)
  }

  const ROSTER_CSV = [
    '姓名,手機,車牌,優先序,P2事由',
    '甲,0955001001,ROST1001,P3,',
    '乙,0955001002,ROST1002,P2,孕婦',
    '丙,0955001003,ROST1003,P1,',
  ].join('\n')

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    ;({ importMembersFromCsvText } = await import('@/server/services/memberImportService'))
    await cleanup()
  })

  afterAll(async () => {
    if (!RUN) return
    await cleanup()
  })

  it('P3/P1 create user+vehicle with NO eligibility; P2 creates a review-required eligibility', async () => {
    const report = await importMembersFromCsvText({ csvText: ROSTER_CSV, dryRun: false }, repo)
    expect(report).toMatchObject({ members: 3, imported: 3, updated: 0, vehiclesAdded: 3, dependentsAdded: 0 })
    expect(report.reviewRequired).toEqual([{ phone: '0955001002', reason: 'pregnancy' }])

    const p3 = (await userByPhone('0955001001'))!
    expect(await eligRow(p3.id)).toBeNull() // P3: no eligibility row
    expect(await vehiclesOf(p3.id)).toHaveLength(1)

    const p1 = (await userByPhone('0955001003'))!
    expect(await eligRow(p1.id)).toBeNull() // P1: general member only, no eligibility

    const p2 = (await userByPhone('0955001002'))!
    expect(await eligRow(p2.id)).toMatchObject({ p2_eligible: true, p2_reason: 'pregnancy', p2_valid_until: null })
    expect((await eligRow(p2.id))!.p2_review_date).not.toBeNull() // Taipei day of apply
  })

  it('re-importing an existing P2 member as P3 keeps eligibility (retained_p2, not revoked); dry-run == apply', async () => {
    const csv = '姓名,手機,車牌,優先序\n乙,0955001002,ROST1002,P3'
    const dry = await importMembersFromCsvText({ csvText: csv, dryRun: true }, repo)
    expect(dry.p2Retained).toEqual([{ phone: '0955001002' }])

    const report = await importMembersFromCsvText({ csvText: csv, dryRun: false }, repo)
    expect(report.updated).toBe(1)
    expect(report.p2Retained).toEqual([{ phone: '0955001002' }])

    // eligibility is untouched — the roster import never revokes an existing P2.
    const p2 = (await userByPhone('0955001002'))!
    expect(await eligRow(p2.id)).toMatchObject({ p2_eligible: true, p2_reason: 'pregnancy' })
  })
})
