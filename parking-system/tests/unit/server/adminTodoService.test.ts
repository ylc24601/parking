import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMockRepo, asRepo, type MockRepo } from './mockRepo'
import { computeAdminTodoCounts, getAdminTodoSnapshot } from '@/server/services/adminTodoService'
import type { EligibilityReviewRow, OutboxHealth } from '@/server/repositories/parkingRepository'

// taipeiToday(NOW) === '2026-07-12'.
const NOW = new Date('2026-07-12T00:00:00Z')

const elig = (over: Partial<EligibilityReviewRow>): EligibilityReviewRow => ({
  user_id: '11111111-1111-4111-8111-111111111111',
  display_name: '王小明',
  p2_reason: 'mobility_short',
  p2_valid_from: null,
  p2_valid_until: null,
  p2_review_date: null,
  reviewed_at: null,
  ...over,
})

const health = (over: Partial<OutboxHealth>): OutboxHealth => ({
  due: 0,
  due_by_template: {},
  pending: 0,
  retrying: 0,
  processing: 0,
  stale_processing: 0,
  failed: 0,
  failed_by_error: {},
  sent_last_24h: 0,
  oldest_pending_at: null,
  oldest_due_at: null,
  oldest_failed_at: null,
  next_retry_at: null,
  ...over,
})

const minsBeforeNow = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

// Fixed thresholds (= the sensitive defaults) so the ops verdict never depends on ambient env.
let savedEnv: Record<string, string | undefined>
beforeEach(() => {
  savedEnv = {
    OUTBOX_ALERT_FAILED_MAX: process.env.OUTBOX_ALERT_FAILED_MAX,
    OUTBOX_ALERT_STALE_MAX: process.env.OUTBOX_ALERT_STALE_MAX,
    OUTBOX_ALERT_PENDING_STALE_MINUTES: process.env.OUTBOX_ALERT_PENDING_STALE_MINUTES,
  }
  process.env.OUTBOX_ALERT_FAILED_MAX = '0'
  process.env.OUTBOX_ALERT_STALE_MAX = '0'
  process.env.OUTBOX_ALERT_PENDING_STALE_MINUTES = '15'
})
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  vi.restoreAllMocks()
})

describe('computeAdminTodoCounts — P2 badge reuses the authoritative classifier', () => {
  it('p2Review = expired + review_due; excludes upcoming and the valid_until==today boundary', async () => {
    const repo: MockRepo = makeMockRepo({
      countOpenPastoralAlerts: vi.fn(async () => 0),
      listEligibilityReview: vi.fn(async () => [
        elig({ user_id: 'a1111111-1111-4111-8111-111111111111', p2_valid_until: '2026-07-11' }),           // expired
        elig({ user_id: 'b1111111-1111-4111-8111-111111111111', p2_review_date: '2026-07-12' }),           // review_due (today)
        elig({ user_id: 'c1111111-1111-4111-8111-111111111111', p2_valid_until: '2026-07-12' }),           // boundary: last day today → active, NOT counted
        elig({ user_id: 'd1111111-1111-4111-8111-111111111111', p2_valid_until: '2026-08-01' }),           // upcoming, NOT counted
      ]),
    })
    const counts = await computeAdminTodoCounts({ now: NOW, role: 'superadmin' }, asRepo(repo))
    expect(counts.p2Review).toBe(2)
  })
})

describe('computeAdminTodoCounts — role gating', () => {
  it('clerk → ops:null and outbox health is NOT fetched', async () => {
    const repo: MockRepo = makeMockRepo({
      countOpenPastoralAlerts: vi.fn(async () => 7),
      listEligibilityReview: vi.fn(async () => []),
    })
    const counts = await computeAdminTodoCounts({ now: NOW, role: 'clerk' }, asRepo(repo))
    expect(counts).toEqual({ p2Review: 0, pastoralOpen: 7, ops: null })
    expect(repo.getOutboxHealth).not.toHaveBeenCalled()
  })
})

describe('computeAdminTodoCounts — ops attention (three states)', () => {
  const runOps = async (h: OutboxHealth) => {
    const repo: MockRepo = makeMockRepo({
      countOpenPastoralAlerts: vi.fn(async () => 0),
      listEligibilityReview: vi.fn(async () => []),
      getOutboxHealth: vi.fn(async () => h),
    })
    return (await computeAdminTodoCounts({ now: NOW, role: 'superadmin' }, asRepo(repo))).ops
  }

  it('failed / stale present → attention = failed + stale, unhealthy', async () => {
    expect(await runOps(health({ failed: 2, stale_processing: 1 }))).toEqual({
      healthy: false, backlog: 0, attention: 3,
    })
  })

  it('ONLY a stale due backlog (failed=0, stale=0) → still unhealthy, attention = due', async () => {
    expect(await runOps(health({ due: 4, oldest_due_at: minsBeforeNow(20) }))).toEqual({
      healthy: false, backlog: 4, attention: 4,
    })
  })

  it('due backlog present but NOT stale → healthy, attention = 0 (no false badge)', async () => {
    expect(await runOps(health({ due: 4, oldest_due_at: minsBeforeNow(5) }))).toEqual({
      healthy: true, backlog: 4, attention: 0,
    })
  })
})

describe('getAdminTodoSnapshot — fail-soft', () => {
  it('a query throwing → counts:null (never "all zero"), snapshotAt set, fixed error logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo: MockRepo = makeMockRepo({
      countOpenPastoralAlerts: vi.fn(async () => { throw new Error('boom') }),
      listEligibilityReview: vi.fn(async () => []),
    })
    const snap = await getAdminTodoSnapshot('superadmin', asRepo(repo), NOW)
    expect(snap.counts).toBeNull()
    expect(snap.snapshotAt).toBe(NOW.toISOString())
    expect(spy).toHaveBeenCalledWith('admin_todo_snapshot_failed')
    // fixed code only — no error object / message leaked
    expect(spy.mock.calls[0]).toHaveLength(1)
  })

  it('success → counts populated, snapshotAt set', async () => {
    const repo: MockRepo = makeMockRepo({
      countOpenPastoralAlerts: vi.fn(async () => 1),
      listEligibilityReview: vi.fn(async () => []),
    })
    const snap = await getAdminTodoSnapshot('clerk', asRepo(repo), NOW)
    expect(snap.counts).toEqual({ p2Review: 0, pastoralOpen: 1, ops: null })
    expect(snap.snapshotAt).toBe(NOW.toISOString())
  })
})
