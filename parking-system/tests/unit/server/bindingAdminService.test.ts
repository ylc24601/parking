import { describe, expect, it, vi } from 'vitest'
import { makeMockRepo, asRepo, type MockRepo } from './mockRepo'
import {
  applyApproveBinding,
  issueBindingCode,
  previewApproveBinding,
  rejectBinding,
} from '@/server/services/bindingAdminService'

const NOW = new Date('2026-07-05T00:00:00Z')
const RAW_LINE_ID = 'Udeadbeefdeadbeefdeadbeefdeadbeef'

function run(over: Partial<MockRepo> = {}) {
  const repo = makeMockRepo(over)
  return { repo, r: asRepo(repo) }
}

describe('issueBindingCode', () => {
  it('generates a code, computes expiry from ttl-days, and returns the full code + member name', async () => {
    const { repo, r } = run()
    const issued = await issueBindingCode({ userId: 'u1', ttlDays: 14, now: NOW }, r)
    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(issued.displayName).toBe('王小明')
    expect(issued.expiresAt).toBe(new Date('2026-07-19T00:00:00Z').toISOString())
    expect(repo.insertBindingCode).toHaveBeenCalledTimes(1)
    const arg = (repo.insertBindingCode as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({ code: issued.code, userId: 'u1', expiresAtIso: issued.expiresAt })
  })

  it('normalizes + validates an explicit --code, and errors on collision', async () => {
    const { r } = run({ insertBindingCode: vi.fn(async () => ({ inserted: false })) })
    await expect(issueBindingCode({ userId: 'u1', ttlDays: 7, code: ' abcd-2345 ', now: NOW }, r))
      .rejects.toThrow(/already exists/)
  })

  it('rejects a malformed explicit code', async () => {
    const { r } = run()
    await expect(issueBindingCode({ userId: 'u1', ttlDays: 7, code: 'no', now: NOW }, r)).rejects.toThrow(/--code must match/)
  })

  it('rejects a non-positive ttl and an unknown user', async () => {
    const { r } = run()
    await expect(issueBindingCode({ userId: 'u1', ttlDays: 0, now: NOW }, r)).rejects.toThrow(/ttl-days/)
    const { r: r2 } = run({ getUserDisplayName: vi.fn(async () => null) })
    await expect(issueBindingCode({ userId: 'nope', ttlDays: 7, now: NOW }, r2)).rejects.toThrow(/user_id not found/)
  })

  it('retries generation on a unique collision, then succeeds', async () => {
    let calls = 0
    const { repo, r } = run({
      insertBindingCode: vi.fn(async () => ({ inserted: ++calls >= 3 })), // first two collide
    })
    const issued = await issueBindingCode({ userId: 'u1', ttlDays: 7, now: NOW }, r)
    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(repo.insertBindingCode).toHaveBeenCalledTimes(3)
  })
})

describe('previewApproveBinding', () => {
  it('returns masked fields + predicted reason and NEVER the raw line_user_id / full code', async () => {
    const { r } = run({
      getBindingApprovalPreview: vi.fn(async () => ({
        pending_status: 'pending',
        line_user_id: RAW_LINE_ID,
        submitted_code: 'ABCD-2345',
        matched_user_id: 'u1',
        matched_display_name: '王小明',
      })),
      approvePendingBinding: vi.fn(async () => ({ approved: 0, would_approve: true, reason: 'approved' })),
    })
    const preview = await previewApproveBinding({ pendingId: 'p1', now: NOW }, r)
    expect(preview).toMatchObject({
      found: true, pendingStatus: 'pending', lineUserIdMasked: 'Udeadb…beef',
      submittedCodeMasked: 'ABCD-****', matchedDisplayName: '王小明', wouldApprove: true, reason: 'approved',
    })
    const s = JSON.stringify(preview)
    expect(s).not.toContain(RAW_LINE_ID)
    expect(s).not.toContain('ABCD-2345')
  })

  it('always calls the RPC in dry-run mode (no write)', async () => {
    const approve = vi.fn(async () => ({ approved: 0, would_approve: false, reason: 'code_expired' }))
    const { r } = run({ approvePendingBinding: approve })
    await previewApproveBinding({ pendingId: 'p1', now: NOW }, r)
    expect(approve).toHaveBeenCalledWith({ pendingId: 'p1', nowIso: NOW.toISOString(), dryRun: true })
  })

  it('reports not-found without display fields', async () => {
    const { r } = run({
      getBindingApprovalPreview: vi.fn(async () => null),
      approvePendingBinding: vi.fn(async () => ({ approved: 0, would_approve: false, reason: 'pending_not_found' })),
    })
    expect(await previewApproveBinding({ pendingId: 'x', now: NOW }, r)).toEqual({
      found: false, wouldApprove: false, reason: 'pending_not_found',
    })
  })
})

describe('applyApproveBinding', () => {
  it('calls the RPC with dryRun=false and returns typed counts', async () => {
    const approve = vi.fn(async () => ({ approved: 1, would_approve: true, reason: 'approved' }))
    const { r } = run({ approvePendingBinding: approve })
    expect(await applyApproveBinding({ pendingId: 'p1', now: NOW }, r)).toEqual({ approved: 1, reason: 'approved' })
    expect(approve).toHaveBeenCalledWith({ pendingId: 'p1', nowIso: NOW.toISOString(), dryRun: false })
  })
})

describe('rejectBinding', () => {
  it('trims the reason and forwards it', async () => {
    const reject = vi.fn(async () => ({ rejected: 1, reason: 'rejected' }))
    const { r } = run({ rejectPendingBinding: reject })
    expect(await rejectBinding({ pendingId: 'p1', reason: '  duplicate ', now: NOW }, r)).toEqual({ rejected: 1, reason: 'rejected' })
    expect(reject).toHaveBeenCalledWith({ pendingId: 'p1', reason: 'duplicate', nowIso: NOW.toISOString() })
  })
  it('rejects an empty reason', async () => {
    const { r } = run()
    await expect(rejectBinding({ pendingId: 'p1', reason: '   ', now: NOW }, r)).rejects.toThrow(/reason must not be empty/)
  })
})
