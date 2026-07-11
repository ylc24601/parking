import { randomBytes } from 'node:crypto'
import { ADMIN_LOGIN_LOCK_MINUTES } from '@/lib/allocation/rules'
import { hashPin } from '@/server/http/pinHash'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'

// ── Admin account management (Phase 8 Slice 3) ───────────────────────────────
// Peer model: admin_accounts has no role hierarchy, so every state-changing action
// here targets an OTHER admin — an acting admin can never disable/reset/revoke
// themselves (self-target is refused before touching the repo; the RPCs behind
// setAdminDisabled/resetAdminPassword refuse it again as defense in depth).
//
// The two write operations wrap single atomic RPCs (migration 0026) — see that
// migration's comments for why a sequence of separate calls is not safe on this
// offboarding security surface (partial failure would leave credentials/sessions
// inconsistent). Reason unions below mirror what those RPCs return.

export type AdminAccountActionReason = 'not_found' | 'cannot_target_self' | 'last_active_admin'

export type AdminAccountActionResult =
  | { ok: true }
  | { ok: false; reason: AdminAccountActionReason }

export interface AdminAccountListItem {
  id: string
  username: string
  displayName: string | null
  status: 'active' | 'disabled' | 'locked'
  createdAt: string
}

export async function listAdmins(
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
): Promise<{ items: AdminAccountListItem[] }> {
  const rows = await repo.listAdminAccounts()
  const items = rows.map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    status: deriveStatus(row.disabled_at, row.locked_at, now),
    createdAt: row.created_at.toISOString(),
  }))
  return { items }
}

function deriveStatus(
  disabledAt: Date | null,
  lockedAt: Date | null,
  now: Date,
): 'active' | 'disabled' | 'locked' {
  if (disabledAt !== null) return 'disabled'
  if (lockedAt !== null && now.getTime() < lockedAt.getTime() + ADMIN_LOGIN_LOCK_MINUTES * 60_000) {
    return 'locked'
  }
  return 'active'
}

export async function setAdminDisabled(
  params: { targetId: string; actingAdminId: string; disabled: boolean },
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
): Promise<AdminAccountActionResult> {
  if (params.targetId === params.actingAdminId) {
    return { ok: false, reason: 'cannot_target_self' }
  }
  const result = await repo.setAdminDisabled({
    targetId: params.targetId,
    actingAdminId: params.actingAdminId,
    disabled: params.disabled,
    nowIso: now.toISOString(),
  })
  if (!result.ok) {
    return { ok: false, reason: (result.reason ?? 'not_found') as AdminAccountActionReason }
  }
  return { ok: true }
}

export type ResetAdminPasswordResult =
  | { ok: true; username: string; password: string; disabled: boolean }
  | { ok: false; reason: AdminAccountActionReason }

// Generates a fresh one-time password (same shape as scripts/run-admin-create.ts:
// 18 random bytes, base64url → 24 chars, ~144 bits), hashes it, and hands the hash
// (never the plaintext) to the atomic reset RPC. The plaintext only ever exists in
// this function's local scope and the ok:true return value — it is not logged and
// does not reach the repository/RPC layer.
export async function resetAdminPassword(
  params: { targetId: string; actingAdminId: string },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ResetAdminPasswordResult> {
  if (params.targetId === params.actingAdminId) {
    return { ok: false, reason: 'cannot_target_self' }
  }
  const password = randomBytes(18).toString('base64url')
  const result = await repo.resetAdminPassword({
    targetId: params.targetId,
    actingAdminId: params.actingAdminId,
    passwordHash: hashPin(password),
  })
  if (!result.ok) {
    return { ok: false, reason: (result.reason ?? 'not_found') as AdminAccountActionReason }
  }
  return { ok: true, username: result.username!, password, disabled: result.disabled! }
}

export async function revokeAdminSessions(
  params: { targetId: string; actingAdminId: string },
  repo: ParkingRepository = createParkingRepository(),
): Promise<AdminAccountActionResult> {
  if (params.targetId === params.actingAdminId) {
    return { ok: false, reason: 'cannot_target_self' }
  }
  const account = await repo.getAdminAccountById(params.targetId)
  if (!account) {
    return { ok: false, reason: 'not_found' }
  }
  await repo.deleteAdminSessionsByAdminId(params.targetId)
  return { ok: true }
}
