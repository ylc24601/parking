import { describe, expect, it, vi } from 'vitest'
import { makeMockRepo, asRepo, type MockRepo } from './mockRepo'
import {
  listAdmins,
  setAdminDisabled,
  resetAdminPassword,
  revokeAdminSessions,
} from '@/server/services/adminAccountService'
import type { AdminAccountListRow, AdminAccountRow } from '@/server/repositories/parkingRepository'

function run(over: Partial<MockRepo> = {}) {
  const repo = makeMockRepo(over)
  return { repo, r: asRepo(repo) }
}

const listRow = (over: Partial<AdminAccountListRow> = {}): AdminAccountListRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice',
  display_name: '王姐妹',
  locked_at: null,
  disabled_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...over,
})

const accountRow = (over: Partial<AdminAccountRow> = {}): AdminAccountRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  username: 'alice',
  password_hash: 'scrypt$old$old',
  failed_attempts: 0,
  locked_at: null,
  disabled_at: null,
  ...over,
})

const SELF = 'self-admin-id'
const TARGET = 'target-admin-id'
const NOW = new Date('2026-07-12T00:00:00Z')

describe('listAdmins', () => {
  it('derives active/disabled/locked status and never exposes password_hash', async () => {
    const { r } = run({
      listAdminAccounts: vi.fn(async () => [
        listRow({ id: 'a', disabled_at: null, locked_at: null }),
        listRow({ id: 'b', disabled_at: new Date('2026-01-01T00:00:00Z') }),
        listRow({ id: 'c', locked_at: new Date(NOW.getTime() - 60_000) }),       // within lock window
        listRow({ id: 'd', locked_at: new Date(NOW.getTime() - 3600_000) }),     // lock window elapsed
      ]),
    })
    const { items } = await listAdmins(r, NOW)
    expect(items.map(i => i.status)).toEqual(['active', 'disabled', 'locked', 'active'])
    expect(JSON.stringify(items)).not.toContain('password_hash')
    expect(JSON.stringify(items)).not.toContain('scrypt$')
  })
})

describe('setAdminDisabled', () => {
  it('self-target → cannot_target_self, repo never called', async () => {
    const setDisabled = vi.fn(async () => ({ ok: true }))
    const { r } = run({ setAdminDisabled: setDisabled })
    const res = await setAdminDisabled({ targetId: SELF, actingAdminId: SELF, disabled: true }, r, NOW)
    expect(res).toEqual({ ok: false, reason: 'cannot_target_self' })
    expect(setDisabled).not.toHaveBeenCalled()
  })

  it('passes through not_found from the repo/RPC', async () => {
    const { r } = run({ setAdminDisabled: vi.fn(async () => ({ ok: false, reason: 'not_found' })) })
    const res = await setAdminDisabled({ targetId: TARGET, actingAdminId: SELF, disabled: true }, r, NOW)
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  it('passes through last_active_admin from the repo/RPC', async () => {
    const { r } = run({ setAdminDisabled: vi.fn(async () => ({ ok: false, reason: 'last_active_admin' })) })
    const res = await setAdminDisabled({ targetId: TARGET, actingAdminId: SELF, disabled: true }, r, NOW)
    expect(res).toEqual({ ok: false, reason: 'last_active_admin' })
  })

  it('disable success calls the repo with disabled:true and the acting admin id', async () => {
    const setDisabled = vi.fn(async () => ({ ok: true }))
    const { repo, r } = run({ setAdminDisabled: setDisabled })
    const res = await setAdminDisabled({ targetId: TARGET, actingAdminId: SELF, disabled: true }, r, NOW)
    expect(res).toEqual({ ok: true })
    expect(repo.setAdminDisabled).toHaveBeenCalledWith({
      targetId: TARGET, actingAdminId: SELF, disabled: true, nowIso: NOW.toISOString(),
    })
  })

  it('enable success calls the repo with disabled:false', async () => {
    const setDisabled = vi.fn(async () => ({ ok: true }))
    const { repo, r } = run({ setAdminDisabled: setDisabled })
    const res = await setAdminDisabled({ targetId: TARGET, actingAdminId: SELF, disabled: false }, r, NOW)
    expect(res).toEqual({ ok: true })
    expect(repo.setAdminDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: false }),
    )
  })
})

describe('resetAdminPassword', () => {
  it('self-target → cannot_target_self, repo never called', async () => {
    const reset = vi.fn(async () => ({ ok: true, username: 'x', disabled: false }))
    const { r } = run({ resetAdminPassword: reset })
    const res = await resetAdminPassword({ targetId: SELF, actingAdminId: SELF }, r)
    expect(res).toEqual({ ok: false, reason: 'cannot_target_self' })
    expect(reset).not.toHaveBeenCalled()
  })

  it('passes through not_found', async () => {
    const { r } = run({ resetAdminPassword: vi.fn(async () => ({ ok: false, reason: 'not_found' })) })
    const res = await resetAdminPassword({ targetId: TARGET, actingAdminId: SELF }, r)
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  it('success returns a fresh plaintext password and passes only its HASH to the repo', async () => {
    const reset = vi.fn(async () => ({ ok: true, username: 'alice', disabled: false }))
    const { repo, r } = run({ resetAdminPassword: reset })
    const res = await resetAdminPassword({ targetId: TARGET, actingAdminId: SELF }, r)
    expect(res).toMatchObject({ ok: true, username: 'alice', disabled: false })
    const password = (res as { password: string }).password
    expect(typeof password).toBe('string')
    expect(password.length).toBeGreaterThan(20)

    const arg = (repo.resetAdminPassword as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.targetId).toBe(TARGET)
    expect(arg.actingAdminId).toBe(SELF)
    expect(arg.passwordHash).toMatch(/^scrypt\$/)
    expect(arg.passwordHash).not.toBe(password)   // hash, not plaintext
  })

  it('generates a different password on each call', async () => {
    const { r } = run({ resetAdminPassword: vi.fn(async () => ({ ok: true, username: 'alice', disabled: false })) })
    const res1 = await resetAdminPassword({ targetId: TARGET, actingAdminId: SELF }, r)
    const res2 = await resetAdminPassword({ targetId: TARGET, actingAdminId: SELF }, r)
    expect((res1 as { password: string }).password).not.toBe((res2 as { password: string }).password)
  })

  it('a disabled target stays reported as disabled (reset does not re-enable)', async () => {
    const { r } = run({ resetAdminPassword: vi.fn(async () => ({ ok: true, username: 'alice', disabled: true })) })
    const res = await resetAdminPassword({ targetId: TARGET, actingAdminId: SELF }, r)
    expect(res).toMatchObject({ ok: true, disabled: true })
  })
})

describe('revokeAdminSessions', () => {
  it('self-target → cannot_target_self, repo never called', async () => {
    const getById = vi.fn(async () => accountRow())
    const del = vi.fn(async () => ({ deleted: 0 }))
    const { r } = run({ getAdminAccountById: getById, deleteAdminSessionsByAdminId: del })
    const res = await revokeAdminSessions({ targetId: SELF, actingAdminId: SELF }, r)
    expect(res).toEqual({ ok: false, reason: 'cannot_target_self' })
    expect(getById).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('unknown target → not_found, delete never called', async () => {
    const del = vi.fn(async () => ({ deleted: 0 }))
    const { r } = run({ getAdminAccountById: vi.fn(async () => null), deleteAdminSessionsByAdminId: del })
    const res = await revokeAdminSessions({ targetId: TARGET, actingAdminId: SELF }, r)
    expect(res).toEqual({ ok: false, reason: 'not_found' })
    expect(del).not.toHaveBeenCalled()
  })

  it('success revokes the target account sessions', async () => {
    const del = vi.fn(async () => ({ deleted: 2 }))
    const { repo, r } = run({ getAdminAccountById: vi.fn(async () => accountRow({ id: TARGET })), deleteAdminSessionsByAdminId: del })
    const res = await revokeAdminSessions({ targetId: TARGET, actingAdminId: SELF }, r)
    expect(res).toEqual({ ok: true })
    expect(repo.deleteAdminSessionsByAdminId).toHaveBeenCalledWith(TARGET)
  })
})
