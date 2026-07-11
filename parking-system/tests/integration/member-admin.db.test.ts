import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Phase 8 Slice 2 — admin member search + detail + issue-code, against local Supabase.
// Gated: `RUN_DB_TESTS=1` (prereq: `npm run db:reset`). No weekly fixture needed.
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

type Sb = import('@supabase/supabase-js').SupabaseClient

// Letters-only isolation tag (UUID hex → a–f), so it's a clean name/plate substring.
const TAG = randomUUID().replace(/[0-9-]/g, '').slice(0, 6).toUpperCase()
const phone = () => `09${String(randomInt(1e8)).padStart(8, '0')}`

describe.skipIf(!RUN)('admin member management (Phase 8 Slice 2) — local DB integration', () => {
  let sb: Sb
  let repo: import('@/server/repositories/parkingRepository').ParkingRepository
  let svc: typeof import('@/server/services/memberAdminService')
  const ids: string[] = []

  // Members: A/B active, C bound. Names + plates carry TAG so a TAG query hits them.
  const A = { id: randomUUID(), phone: phone() }
  const B = { id: randomUUID(), phone: phone() }
  const C = { id: randomUUID(), phone: phone() }

  const mkUser = async (id: string, name: string, phoneNo: string, lineId: string | null = null) => {
    await sb.from('users').insert({ id, display_name: name, phone_number: phoneNo, line_id: lineId }).throwOnError()
    ids.push(id)
  }
  const mkVehicle = async (userId: string, plate: string, active = true) => {
    await sb.from('vehicles').insert({ user_id: userId, license_plate: plate, is_active: active }).throwOnError()
  }

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    repo = (await import('@/server/repositories/parkingRepository')).createParkingRepository(sb)
    svc = await import('@/server/services/memberAdminService')

    await mkUser(A.id, `${TAG}A`, A.phone)
    await mkVehicle(A.id, `${TAG}CAR1`)
    await sb.from('user_eligibility').insert({
      user_id: A.id, p2_eligible: true, p2_reason: 'mobility_long',
      p2_valid_until: '2099-01-01', p2_review_date: '2098-12-01',
    }).throwOnError()
    await sb.from('eligibility_dependents').insert({
      user_id: A.id, dependent_kind: 'child', dependent_name: `${TAG}童`, dependent_birthdate: '2022-03-01',
    }).throwOnError()

    await mkUser(B.id, `${TAG}B`, B.phone)
    await mkVehicle(B.id, `${TAG}CAR2`)
    await mkVehicle(B.id, `${TAG}OLD9`, false)   // inactive — must not be searchable/shown

    await mkUser(C.id, `${TAG}C`, C.phone, `U${TAG}BOUND`)
  })

  afterAll(async () => {
    if (!RUN) return
    for (const id of ids) {
      await sb.from('binding_codes').delete().eq('user_id', id)
      await sb.from('eligibility_dependents').delete().eq('user_id', id)
      await sb.from('user_eligibility').delete().eq('user_id', id)
      await sb.from('vehicles').delete().eq('user_id', id)
      await sb.from('users').delete().eq('id', id)
    }
  })

  // ── search ──────────────────────────────────────────────────────────────────

  it('a name-tag query finds all three, distinct, stable-sorted by name', async () => {
    const { items } = await svc.searchMembers({ query: TAG }, repo)
    const tagged = items.filter(i => i.displayName.startsWith(TAG))
    expect(tagged.map(i => i.displayName)).toEqual([`${TAG}A`, `${TAG}B`, `${TAG}C`])
    // Bound flag + masked phone.
    expect(tagged.find(i => i.displayName === `${TAG}C`)!.bound).toBe(true)
    expect(tagged.find(i => i.displayName === `${TAG}A`)!.phoneMasked).not.toContain(A.phone)
  })

  it('repo: phone-only and plate-only branches each hit the right member', async () => {
    const byPhone = await repo.searchMembers({ nameQuery: null, phoneQuery: A.phone, plateQuery: null, candidateCap: 250 })
    expect(byPhone.map(r => r.id)).toEqual([A.id])
    const byPlate = await repo.searchMembers({ nameQuery: null, phoneQuery: null, plateQuery: `${TAG}CAR1`, candidateCap: 250 })
    expect(byPlate.map(r => r.id)).toEqual([A.id])
  })

  it('repo: an inactive plate is neither searchable nor summarized', async () => {
    const byInactive = await repo.searchMembers({ nameQuery: null, phoneQuery: null, plateQuery: `${TAG}OLD9`, candidateCap: 250 })
    expect(byInactive).toEqual([])
    const bTag = await repo.searchMembers({ nameQuery: `${TAG}B`, phoneQuery: null, plateQuery: null, candidateCap: 250 })
    expect(bTag[0].plates).toEqual([`${TAG}CAR2`])   // OLD9 excluded
  })

  it('repo: a member matching name + phone + plate at once is returned exactly once', async () => {
    const rows = await repo.searchMembers({
      nameQuery: `${TAG}A`, phoneQuery: A.phone, plateQuery: `${TAG}CAR1`, candidateCap: 250,
    })
    expect(rows.filter(r => r.id === A.id)).toHaveLength(1)
  })

  it('service hasMore: limit 1 against 3 matches → one item, hasMore true', async () => {
    const { items, hasMore } = await svc.searchMembers({ query: TAG, limit: 1 }, repo)
    expect(items).toHaveLength(1)
    expect(hasMore).toBe(true)
  })

  // ── detail ──────────────────────────────────────────────────────────────────

  it('detail: full shape incl. vehicles, eligibility, dependents; bound flag not line_id', async () => {
    const d = (await svc.getMemberDetail(A.id, repo))!
    expect(d.phone).toBe(A.phone)
    expect(d.bound).toBe(false)
    expect(d.vehicles).toEqual([{ plate: `${TAG}CAR1`, nickname: null }])
    expect(d.eligibility).toMatchObject({ p2Eligible: true, p2Reason: 'mobility_long', p2ValidUntil: '2099-01-01', p2ReviewDate: '2098-12-01' })
    expect(d.dependents).toEqual([{ kind: 'child', name: `${TAG}童`, birthdate: '2022-03-01' }])
    expect(JSON.stringify(d)).not.toContain('line_id')
  })

  it('detail: eligibility null when the member has no eligibility row', async () => {
    const d = (await svc.getMemberDetail(B.id, repo))!
    expect(d.eligibility).toBeNull()
    expect(d.vehicles).toEqual([{ plate: `${TAG}CAR2`, nickname: null }])   // inactive excluded
  })

  it('detail: unknown id → null', async () => {
    expect(await svc.getMemberDetail(randomUUID(), repo)).toBeNull()
  })

  // ── issue code ────────────────────────────────────────────────────────────────

  it('issue: unbound member → binding_codes row written with created_by audit', async () => {
    const res = await svc.issueMemberBindingCode({ userId: A.id, ttlDays: 30, createdBy: 'admin:tester' }, repo)
    expect(res.ok).toBe(true)
    const code = (res as { code: string }).code
    const { data } = await sb.from('binding_codes').select('user_id, created_by, consumed_at').eq('code', code).single()
    expect(data!.user_id).toBe(A.id)
    expect(data!.created_by).toBe('admin:tester')
    expect(data!.consumed_at).toBeNull()
  })

  it('issue: bound member → already_bound (precheck), no code written', async () => {
    const res = await svc.issueMemberBindingCode({ userId: C.id, createdBy: 'admin:tester' }, repo)
    expect(res).toEqual({ ok: false, reason: 'already_bound' })
    const { data } = await sb.from('binding_codes').select('id').eq('user_id', C.id)
    expect(data).toEqual([])
  })

  it('issue: unknown member → member_not_found', async () => {
    expect(await svc.issueMemberBindingCode({ userId: randomUUID(), createdBy: 'admin:tester' }, repo))
      .toEqual({ ok: false, reason: 'member_not_found' })
  })
})
