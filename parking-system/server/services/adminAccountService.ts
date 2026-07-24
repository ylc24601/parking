import { randomBytes } from 'node:crypto'
import type { AdminRole } from '@/lib/adminRoles'
import { ADMIN_LOGIN_LOCK_MINUTES } from '@/lib/allocation/rules'
import { hashPin } from '@/server/http/pinHash'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import { requireAdminActor, type AuditActor } from '@/server/services/auditContext'

// ── Admin account management (Phase 8 Slice 3) ───────────────────────────────
// Every state-changing action here targets an OTHER admin — an acting admin can never
// disable/reset/revoke themselves (self-target is refused before touching the repo;
// the RPCs behind setAdminDisabled/resetAdminPassword refuse it again as defense in
// depth).
//
// The two write operations wrap single atomic RPCs (migration 0026) — see that
// migration's comments for why a sequence of separate calls is not safe on this
// offboarding security surface (partial failure would leave credentials/sessions
// inconsistent). Reason unions below mirror what those RPCs return.
//
// Wave 2C-1 (#19): this whole surface is superadmin-only. The routes refuse a clerk
// before reaching here, and the RPCs refuse one again inside the transaction from the
// role they read themselves — a role is never taken on the caller's word.

export type AdminAccountActionReason =
  | 'not_found'
  | 'cannot_target_self'
  // The invariant: at least one enabled superadmin must remain. Unreachable through
  // today's RPCs — the actor must itself be an active superadmin and cannot target
  // itself, so one always survives (see 0035's comment on the guard). Kept in the
  // union so a future path that CAN shrink the set does not land on an unmapped
  // reason and 500.
  | 'last_active_superadmin'
  // Race guards between the auth check and the transaction (adminAuth deletes a
  // disabled account's session on every request, so neither should be reachable).
  | 'forbidden_role'
  | 'acting_admin_disabled'
  | 'acting_admin_not_found'

export type AdminAccountActionResult =
  | { ok: true }
  | { ok: false; reason: AdminAccountActionReason }

// One HTTP mapping for the whole surface, so disable/reset/revoke cannot drift apart.
// The three race guards collapse to 403 on the wire (they are all "you may not, as
// you are"); the distinction survives in the RPC's return value and the audit row.
export const ADMIN_ACCOUNT_ACTION_STATUS: Record<AdminAccountActionReason, number> = {
  not_found: 404,
  cannot_target_self: 403,
  forbidden_role: 403,
  acting_admin_disabled: 403,
  acting_admin_not_found: 403,
  last_active_superadmin: 409,
}

export interface AdminAccountListItem {
  id: string
  username: string
  displayName: string | null
  status: 'active' | 'disabled' | 'locked'
  createdAt: string
  role: AdminRole
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
    role: row.role,
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

// Audited (0030). The actor and requestId are passed straight through to the RPC,
// which writes the audit row in the same transaction — this service must not build
// metadata, must not write a second row, and must not catch an audit failure and
// report success: an audit failure means the disable did not happen.
export async function setAdminDisabled(
  params: { targetId: string; actor: AuditActor; disabled: boolean; requestId: string },
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
): Promise<AdminAccountActionResult> {
  const { adminId, sessionId } = requireAdminActor(params.actor)
  if (params.targetId === adminId) {
    return { ok: false, reason: 'cannot_target_self' }
  }
  const result = await repo.setAdminDisabled({
    targetId: params.targetId,
    actingAdminId: adminId,
    actingSessionId: sessionId,
    disabled: params.disabled,
    nowIso: now.toISOString(),
    requestId: params.requestId,
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
//
// Audited since 0035, on the same terms as setAdminDisabled: the row is written inside
// the RPC's transaction, so this must not build metadata and must not report success
// if the audit write failed.
export async function resetAdminPassword(
  params: { targetId: string; actor: AuditActor; requestId: string },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ResetAdminPasswordResult> {
  const { adminId, sessionId } = requireAdminActor(params.actor)
  if (params.targetId === adminId) {
    return { ok: false, reason: 'cannot_target_self' }
  }
  const password = randomBytes(18).toString('base64url')
  const result = await repo.resetAdminPassword({
    targetId: params.targetId,
    actingAdminId: adminId,
    actingSessionId: sessionId,
    passwordHash: hashPin(password),
    requestId: params.requestId,
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
