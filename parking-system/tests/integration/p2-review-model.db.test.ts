import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { childCompanionValidUntil } from '@/lib/eligibilityStatus'
import { auditActionLabel, renderAuditDetails, UNKNOWN_ACTION_DETAIL, UNREADABLE_DETAIL } from '@/server/services/auditPresentation'

// Wave 2B-2a (#10) — the eligibility MODEL: review_status is the authority, p2_eligible
// is generated from it and nothing else, and a bulk import cannot overturn a review.
//
// Gated: `RUN_DB_TESTS=1` + reachable local Supabase (prereq: `npm run db:reset`).
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may already be exported */
}
const RUN = process.env.RUN_DB_TESTS === '1'

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const TAG = 'P2M-'
type Sb = import('@supabase/supabase-js').SupabaseClient

describe.skipIf(!RUN)('P2 eligibility model (Wave 2B-2a / #10)', () => {
  let sb: Sb
  let pg: Client
  const ids: string[] = []
  const adminIds: string[] = []

  const mkMember = async (label: string) => {
    const id = randomUUID()
    await sb.from('users').insert({ id, display_name: `${TAG}${label}` }).throwOnError()
    ids.push(id)
    return id
  }
  const eligOf = async (userId: string) =>
    (await sb.from('user_eligibility').select('*').eq('user_id', userId).single()).data as Record<string, unknown>

  beforeAll(async () => {
    sb = (await import('@/lib/supabase/server')).getServiceClient()
    pg = new Client({ connectionString: DB_URL })
    await pg.connect()
  })

  afterAll(async () => {
    if (RUN) {
      for (const id of ids) {
        await sb.from('user_eligibility').delete().eq('user_id', id)
        await sb.from('eligibility_dependents').delete().eq('user_id', id)
        await sb.from('users').delete().eq('id', id)
      }
      // After the members: reviewed_by FKs admin_accounts, so the reviewer cannot go first.
      for (const id of adminIds) await sb.from('admin_accounts').delete().eq('id', id)
    }
    await pg?.end()
  })

  // ── p2_eligible is derived, and the DB is what enforces it ────────────────────
  describe('p2_eligible is generated from review_status alone', () => {
    it('rejects an INSERT that tries to write it — this is why import_member had to change', async () => {
      const id = await mkMember('GenIns')
      await expect(
        pg.query(
          `insert into user_eligibility (user_id, review_status, p2_reason, p2_eligible)
           values ($1, 'approved', 'pregnancy', true)`,
          [id],
        ),
      ).rejects.toThrow(/cannot insert a non-DEFAULT value/)
    })

    it('rejects an UPDATE that tries to write it', async () => {
      const id = await mkMember('GenUpd')
      await sb.from('user_eligibility')
        .insert({ user_id: id, review_status: 'approved', p2_reason: 'pregnancy' }).throwOnError()
      await expect(
        pg.query(`update user_eligibility set p2_eligible = false where user_id = $1`, [id]),
      ).rejects.toThrow(/can only be updated to DEFAULT/)
    })

    it.each([
      ['approved', true],
      ['unreviewed', false],
      ['revoked', false],
    ])('review_status %s → p2_eligible %s', async (status, expected) => {
      const id = await mkMember(`Gen${status}`)
      await sb.from('user_eligibility')
        .insert({ user_id: id, review_status: status, p2_reason: status === 'approved' ? 'pregnancy' : null })
        .throwOnError()
      expect((await eligOf(id)).p2_eligible).toBe(expected)
    })

    it('flipping review_status flips p2_eligible with no writer touching it', async () => {
      const id = await mkMember('GenFlip')
      await sb.from('user_eligibility')
        .insert({ user_id: id, review_status: 'approved', p2_reason: 'pregnancy' }).throwOnError()
      expect((await eligOf(id)).p2_eligible).toBe(true)

      await sb.from('user_eligibility').update({ review_status: 'revoked' }).eq('user_id', id).throwOnError()
      expect((await eligOf(id)).p2_eligible).toBe(false)
    })

  })

  // ── The window CHECKs ─────────────────────────────────────────────────────────
  describe('window constraints', () => {
    it('rejects valid_from later than valid_until', async () => {
      const id = await mkMember('CkOrder')
      await expect(
        pg.query(
          `insert into user_eligibility (user_id, review_status, p2_reason, p2_valid_from, p2_valid_until)
           values ($1, 'approved', 'pregnancy', '2026-08-01', '2026-07-01')`,
          [id],
        ),
      ).rejects.toThrow(/eligibility_window_ordered_ck/)
    })

    it('accepts a single-day window (both bounds inclusive)', async () => {
      const id = await mkMember('CkSameDay')
      await sb.from('user_eligibility').insert({
        user_id: id, review_status: 'approved', p2_reason: 'pregnancy',
        p2_valid_from: '2026-07-12', p2_valid_until: '2026-07-12',
      }).throwOnError()
      expect((await eligOf(id)).p2_valid_from).toBe('2026-07-12')
    })

    it('only child_companion may carry a source birthdate', async () => {
      const id = await mkMember('CkChildBd')
      await expect(
        pg.query(
          `insert into user_eligibility (user_id, review_status, p2_reason, p2_child_birthdate)
           values ($1, 'approved', 'pregnancy', '2020-01-01')`,
          [id],
        ),
      ).rejects.toThrow(/eligibility_child_birthdate_reason_ck/)
    })

    it('a child_companion with NO birthdate on file stays representable', async () => {
      // The review-required state memberImport.ts:138 produces. A `child_companion =>
      // birthdate not null` CHECK would have made this real, existing row illegal.
      const id = await mkMember('CkChildNoBd')
      await sb.from('user_eligibility').insert({
        user_id: id, review_status: 'approved', p2_reason: 'child_companion',
        p2_child_birthdate: null, p2_valid_until: null,
      }).throwOnError()
      expect((await eligOf(id)).p2_child_birthdate).toBeNull()
    })
  })

  // ── reviewed_by points at the table reviewers actually live in ────────────────
  describe('reviewed_by', () => {
    it('accepts an admin_accounts id and REJECTS a users id', async () => {
      const id = await mkMember('RevBy')
      await sb.from('user_eligibility')
        .insert({ user_id: id, review_status: 'approved', p2_reason: 'pregnancy' }).throwOnError()

      // A MEMBER id — exactly what 0001's FK pointed at, and exactly what a reviewer never
      // is. This must bounce, or the column could hold a member as its own reviewer.
      await expect(
        pg.query(`update user_eligibility set reviewed_by = $1 where user_id = $1`, [id]),
      ).rejects.toThrow(/user_eligibility_reviewed_by_fkey/)

      // An ADMIN id — what 2B-2b will actually write. The seed ships no admin account, so
      // make one rather than depend on ambient state.
      // admin_accounts_username_ck requires lowercase [a-z0-9_.-]{3,32};
      // admin_accounts_password_hash_ck pins the scrypt$ prefix. This row never logs in.
      const admin = (await pg.query(
        `insert into admin_accounts (username, password_hash) values ($1, 'scrypt$notarealhash') returning id`,
        [`p2m-reviewer-${randomUUID().slice(0, 8)}`],
      )).rows[0]
      adminIds.push(admin.id)

      await pg.query(`update user_eligibility set reviewed_by = $1 where user_id = $2`, [admin.id, id])
      expect((await eligOf(id)).reviewed_by).toBe(admin.id)
    })
  })

  // ── The markers 0032 actually wrote, through the real presenter ───────────────
  describe("0032's migration markers render for real", () => {
    // The unit tests in auditPresentation.test.ts assert the renderers against metadata
    // shapes I typed by hand — which proves the renderer, not the CONTRACT. If the
    // migration writes a key the registry doesn't declare (or vice versa), those tests
    // stay green and the real timeline shows 「未知動作」/「格式無法辨識」. This reads the
    // rows the migration genuinely produced and renders them.
    it('both markers render as real actions, with no unreadable/unknown fallback', async () => {
      const { rows } = await pg.query(
        `select action, metadata_redacted from audit_logs
          where action like 'p2_eligibility%' order by created_at`)
      expect(rows.map(r => r.action)).toEqual([
        'p2_eligibility.review_status_backfill',
        'p2_eligibility.child_expiry_recompute',
      ])

      for (const r of rows) {
        const rendered = renderAuditDetails(r.action, r.metadata_redacted)
        expect(auditActionLabel(r.action)).not.toBe(r.action)   // labelled, not a raw code
        expect(rendered.fallback).not.toBe(UNKNOWN_ACTION_DETAIL)
        expect(rendered.fallback).not.toBe(UNREADABLE_DETAIL)
        expect(rendered.fallback).toBeNull()
        expect(rendered.details.length).toBeGreaterThan(0)
        // Every key the migration writes must be one the registry declared — an
        // unsupported count here means the two sides have already drifted apart.
        expect(rendered.unsupportedCount).toBe(0)
      }
    })

    it('the backfill marker never claims a revocation happened', async () => {
      // The old boolean model could not record WHO revoked anything, so a revoked_count
      // in an append-only row would be a permanent fabrication.
      const { rows } = await pg.query(
        `select metadata_redacted from audit_logs
          where action = 'p2_eligibility.review_status_backfill'`)
      expect(Object.keys(rows[0].metadata_redacted)).not.toContain('revoked_count')
      expect(JSON.stringify(renderAuditDetails(
        'p2_eligibility.review_status_backfill', rows[0].metadata_redacted,
      ))).not.toContain('撤銷')
    })

    it('the child recompute shortened nothing', async () => {
      const { rows } = await pg.query(
        `select metadata_redacted from audit_logs
          where action = 'p2_eligibility.child_expiry_recompute'`)
      expect(rows[0].metadata_redacted.rows_shortened).toBe(0)
      expect(rows[0].metadata_redacted.rule).toBe('tw_school_cohort_v1')
    })
  })

  // ── The cohort formula exists twice; this is the mitigation ───────────────────
  describe('child cohort rule: SQL (0032 recompute) vs TS (childCompanionValidUntil)', () => {
    // One shared fixture table drives BOTH sides, so neither can miss a case the other
    // covers — the same mitigation 0031 used for the capacity formula.
    //
    // Honest scope: the SQL side here is the same expression 0032 runs, re-executed as a
    // query. It cannot drive the migration itself (that ran once, at db:reset, against an
    // empty table). What it proves is that the two formulas AGREE — which is the part that
    // could silently rot. The migration's own `rows_shortened > 0 -> raise` guards the rest.
    const FIXTURES = [
      '2019-01-15', // well before the cutoff
      '2019-08-31', // day before
      '2019-09-01', // ON the cutoff — inclusive, earlier cohort
      '2019-09-02', // day after — next cohort, a full year later
      '2019-12-31', // well after
      '2020-02-29', // leap day
      '2024-06-15',
    ]

    // ⚠️ Every date is cast ::text IN SQL. node-postgres hydrates a `date` into a JS Date at
    // LOCAL midnight, so toISOString() on it subtracts the Taipei offset and silently yields
    // the previous day — 2025-08-31 arrives as '2025-08-30'. This test caught exactly that,
    // and it would have "failed" against correct SQL. Same family as 2A-2's cursor bug: a
    // Date round-trip is never a safe way to move a DB date into JS.
    it('agrees with TS for every fixture birthdate', async () => {
      const sql = `
        select b as bd,
               make_date(
                 extract(year from b::date)::int + 6
                   + case when (extract(month from b::date)::int,
                                extract(day   from b::date)::int) > (9, 1) then 1 else 0 end,
                 8, 31)::text as until
          from unnest($1::text[]) as t(b)`
      const { rows } = await pg.query(sql, [FIXTURES])
      expect(rows).toHaveLength(FIXTURES.length)

      for (const r of rows) {
        expect(r.until as string).toBe(childCompanionValidUntil(r.bd as string))
      }
    })

    it('the 9/1 vs 9/2 boundary is a full year, in SQL too', async () => {
      const { rows } = await pg.query(`
        select make_date(extract(year from b)::int + 6
                 + case when (extract(month from b)::int, extract(day from b)::int) > (9,1) then 1 else 0 end,
                 8, 31)::text as until
          from (values ('2019-09-01'::date), ('2019-09-02'::date)) as t(b)`)
      expect(rows.map(r => r.until as string)).toEqual(['2025-08-31', '2026-08-31'])
    })
  })
})
