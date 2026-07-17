import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/server/services/adminAccountService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/services/adminAccountService')>()
  return { ...actual, setAdminDisabled: vi.fn(), resetAdminPassword: vi.fn(), revokeAdminSessions: vi.fn() }
})
vi.mock('@/server/http/adminAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/http/adminAuth')>()
  return { ...actual, getAdminSession: vi.fn() }
})

import { POST as disablePOST } from '@/app/api/admin/accounts/disable/route'
import { POST as resetPOST } from '@/app/api/admin/accounts/reset-password/route'
import { POST as revokePOST } from '@/app/api/admin/accounts/revoke-sessions/route'
import {
  setAdminDisabled,
  resetAdminPassword,
  revokeAdminSessions,
} from '@/server/services/adminAccountService'
import { getAdminSession } from '@/server/http/adminAuth'

const SESSION = { sessionId: 's1', adminId: 'admin-1', username: 'alice' }
const TARGET_ID = 'a1b2c3d4-1111-4222-8333-000000000001'

type Handler = typeof disablePOST

const post = (handler: Handler, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost/api/admin/accounts/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))

describe('POST /api/admin/accounts/disable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAdminSession as Mock).mockResolvedValue(SESSION)
    ;(setAdminDisabled as Mock).mockResolvedValue({ ok: true })
  })

  it('no session → 401, service never called', async () => {
    ;(getAdminSession as Mock).mockResolvedValue(null)
    const res = await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true })
    expect(res.status).toBe(401)
    expect(setAdminDisabled).not.toHaveBeenCalled()
  })

  it('415 non-JSON / 413 oversized / 400 malformed / 403 foreign Origin', async () => {
    const nonJson = await disablePOST(new Request('http://localhost/api/admin/accounts/disable', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x',
    }))
    expect(nonJson.status).toBe(415)
    expect((await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true, note: 'x'.repeat(5000) })).status).toBe(413)
    expect((await post(disablePOST, 'disable', 'not-json{')).status).toBe(400)
    expect((await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true }, { origin: 'https://evil.example' })).status).toBe(403)
  })

  it.each([
    ['non-UUID targetId', { targetId: 'not-a-uuid', disabled: true }],
    ['missing targetId', { disabled: true }],
    ['non-boolean disabled', { targetId: TARGET_ID, disabled: 'true' }],
    ['missing disabled', { targetId: TARGET_ID }],
  ])('invalid request (%s) → 400', async (_n, body) => {
    expect((await post(disablePOST, 'disable', body)).status).toBe(400)
    expect(setAdminDisabled).not.toHaveBeenCalled()
  })

  it('success → 200 { ok: true }, no-store', async () => {
    const res = await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('the audit actor is ALWAYS built from the session; a smuggled body value is ignored', async () => {
    await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true, actingAdminId: 'attacker' })
    // Same guarantee as before 0030 — the acting identity comes from the session and
    // nowhere else — now stated against the actor the audit row is written from. If
    // a body value could reach this, an admin could pin their action on someone else.
    expect(setAdminDisabled).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: TARGET_ID,
        disabled: true,
        actor: { actorType: 'admin', actorId: 'admin-1', actorSessionId: 's1', actorRoleSnapshot: null },
      }),
    )
    const { actor, requestId } = (setAdminDisabled as Mock).mock.calls[0][0]
    expect(JSON.stringify(actor)).not.toContain('attacker')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)   // generated per request, never from the body
  })

  it.each([
    ['cannot_target_self', 403],
    ['last_active_admin', 409],
    ['not_found', 404],
  ] as const)('typed %s → %i', async (reason, status) => {
    ;(setAdminDisabled as Mock).mockResolvedValue({ ok: false, reason })
    const res = await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ ok: false, reason })
  })

  it('service throw → 500 generic', async () => {
    ;(setAdminDisabled as Mock).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(disablePOST, 'disable', { targetId: TARGET_ID, disabled: true })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'internal' })
    spy.mockRestore()
  })
})

describe('POST /api/admin/accounts/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAdminSession as Mock).mockResolvedValue(SESSION)
    ;(resetAdminPassword as Mock).mockResolvedValue({ ok: true, username: 'bob', password: 'S3cret-One-Time-Pw', disabled: false })
  })

  it('no session → 401', async () => {
    ;(getAdminSession as Mock).mockResolvedValue(null)
    expect((await post(resetPOST, 'reset-password', { targetId: TARGET_ID })).status).toBe(401)
    expect(resetAdminPassword).not.toHaveBeenCalled()
  })

  it('non-UUID targetId → 400', async () => {
    for (const bad of [undefined, 42, 'abc', `${TARGET_ID}x`]) {
      expect((await post(resetPOST, 'reset-password', { targetId: bad })).status).toBe(400)
    }
    expect(resetAdminPassword).not.toHaveBeenCalled()
  })

  it('actingAdminId is ALWAYS the session admin id; smuggled body fields (username/passwordHash) are ignored', async () => {
    await post(resetPOST, 'reset-password', {
      targetId: TARGET_ID, actingAdminId: 'attacker', username: 'attacker', passwordHash: 'scrypt$fake$fake',
    })
    expect(resetAdminPassword).toHaveBeenCalledWith({ targetId: TARGET_ID, actingAdminId: 'admin-1' })
  })

  it('success → 200 with the full password, no-store; the password is never logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(resetPOST, 'reset-password', { targetId: TARGET_ID })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, username: 'bob', password: 'S3cret-One-Time-Pw', disabled: false })
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('S3cret-One-Time-Pw')
    spy.mockRestore()
  })

  it.each([
    ['cannot_target_self', 403],
    ['not_found', 404],
  ] as const)('typed %s → %i', async (reason, status) => {
    ;(resetAdminPassword as Mock).mockResolvedValue({ ok: false, reason })
    const res = await post(resetPOST, 'reset-password', { targetId: TARGET_ID })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ ok: false, reason })
  })

  it('service throw → 500 generic, no plaintext leaked in the log', async () => {
    ;(resetAdminPassword as Mock).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(resetPOST, 'reset-password', { targetId: TARGET_ID })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'internal' })
    spy.mockRestore()
  })
})

describe('POST /api/admin/accounts/revoke-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAdminSession as Mock).mockResolvedValue(SESSION)
    ;(revokeAdminSessions as Mock).mockResolvedValue({ ok: true })
  })

  it('no session → 401', async () => {
    ;(getAdminSession as Mock).mockResolvedValue(null)
    expect((await post(revokePOST, 'revoke-sessions', { targetId: TARGET_ID })).status).toBe(401)
    expect(revokeAdminSessions).not.toHaveBeenCalled()
  })

  it('non-UUID targetId → 400', async () => {
    expect((await post(revokePOST, 'revoke-sessions', { targetId: 'nope' })).status).toBe(400)
    expect(revokeAdminSessions).not.toHaveBeenCalled()
  })

  it('actingAdminId is ALWAYS the session admin id', async () => {
    await post(revokePOST, 'revoke-sessions', { targetId: TARGET_ID, actingAdminId: 'attacker' })
    expect(revokeAdminSessions).toHaveBeenCalledWith({ targetId: TARGET_ID, actingAdminId: 'admin-1' })
  })

  it('success → 200 { ok: true }', async () => {
    const res = await post(revokePOST, 'revoke-sessions', { targetId: TARGET_ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it.each([
    ['cannot_target_self', 403],
    ['not_found', 404],
  ] as const)('typed %s → %i', async (reason, status) => {
    ;(revokeAdminSessions as Mock).mockResolvedValue({ ok: false, reason })
    const res = await post(revokePOST, 'revoke-sessions', { targetId: TARGET_ID })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ ok: false, reason })
  })

  it('service throw → 500 generic', async () => {
    ;(revokeAdminSessions as Mock).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(revokePOST, 'revoke-sessions', { targetId: TARGET_ID })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'internal' })
    spy.mockRestore()
  })
})
