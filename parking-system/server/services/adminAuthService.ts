import {
  ADMIN_LOGIN_LOCK_MINUTES,
  ADMIN_LOGIN_MAX_ATTEMPTS,
  ADMIN_SESSION_TTL_HOURS,
} from '@/lib/allocation/rules'
import { hashPin, verifyPin } from '@/server/http/pinHash'
import { generateSessionToken, hashSessionToken } from '@/server/http/sessionToken'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'

// ── Admin UI login (Phase 8 Slice 1) ─────────────────────────────────────────
// Per-admin username + scrypt password (admin_accounts), member-style opaque-token
// session (admin_sessions stores sha256 only). Privacy posture: unknown username,
// wrong password, disabled account, and an active lock are all externally the same
// 401 `invalid` (the route collapses `locked` too) — and every one of those paths
// burns one scrypt verify so response TIMING can't distinguish them either.
// An expired lock starts a NEW counting round (apply_admin_login_failure, 0025).

// Raw input bounds: anything beyond these is rejected before any DB read.
const MAX_USERNAME_RAW = 100
const MAX_PASSWORD_RAW = 512

const USERNAME_FORMAT = /^[a-z0-9_.-]{3,32}$/
const MIN_PASSWORD_LENGTH = 12
const MAX_DISPLAY_NAME_CODEPOINTS = 80

// Fixed scrypt target for the no-account / disabled / locked paths. Computed once at
// module load; the password compared against it is the caller's, so the work factor
// matches a real verify.
const DUMMY_HASH = hashPin('admin-timing-equalizer')

export type AdminLoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'locked' }

function isLocked(lockedAt: Date | null, now: Date): boolean {
  if (!lockedAt) return false
  return now.getTime() < lockedAt.getTime() + ADMIN_LOGIN_LOCK_MINUTES * 60_000
}

export async function loginAdmin(
  input: { username?: unknown; password?: unknown },
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
): Promise<AdminLoginResult> {
  const { username, password } = input
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, reason: 'invalid' }
  }
  if (username.length === 0 || username.length > MAX_USERNAME_RAW) {
    return { ok: false, reason: 'invalid' }
  }
  if (password.length === 0 || password.length > MAX_PASSWORD_RAW) {
    return { ok: false, reason: 'invalid' }
  }
  const normalized = username.trim().toLowerCase()
  if (normalized.length === 0) return { ok: false, reason: 'invalid' }

  const account = await repo.getAdminAccountByUsername(normalized)
  if (!account) {
    verifyPin(password, DUMMY_HASH)
    return { ok: false, reason: 'invalid' }
  }
  if (account.disabled_at !== null) {
    verifyPin(password, DUMMY_HASH)
    return { ok: false, reason: 'invalid' }
  }
  // Active lock: no verify against the real hash, no counter bump (repeated attempts
  // must not extend the lock) — but still one scrypt so timing stays flat.
  if (isLocked(account.locked_at, now)) {
    verifyPin(password, DUMMY_HASH)
    return { ok: false, reason: 'locked' }
  }

  if (verifyPin(password, account.password_hash)) {
    // Clears failed_attempts AND a stale (expired) locked_at.
    await repo.resetAdminLoginFailures(account.id)
    await repo.deleteExpiredAdminSessions(account.id, now.toISOString())

    const token = generateSessionToken()
    // Must throw on failure (route → 500): the cookie is only set after this row
    // exists, and the raw token is never logged.
    await repo.createAdminSession({
      adminId: account.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_HOURS * 3600_000).toISOString(),
    })
    return { ok: true, token }
  }

  // Lock-cycle semantics live in the RPC (atomic): expired lock → this failure is #1.
  const after = await repo.applyAdminLoginFailure({
    id: account.id,
    nowIso: now.toISOString(),
    threshold: ADMIN_LOGIN_MAX_ATTEMPTS,
    lockMinutes: ADMIN_LOGIN_LOCK_MINUTES,
  })
  return { ok: false, reason: isLocked(after.locked_at, now) ? 'locked' : 'invalid' }
}

// CLI provisioning (scripts/run-admin-create.ts). The plaintext password is hashed
// here and never stored or logged.
export async function createAdminAccount(
  args: { username: string; password: string; displayName?: string | null },
  repo: ParkingRepository = createParkingRepository(),
): Promise<{ username: string }> {
  const username = args.username.trim().toLowerCase()
  if (!USERNAME_FORMAT.test(username)) {
    throw new Error(`username must match ${USERNAME_FORMAT} after trim+lowercase`)
  }
  if (typeof args.password !== 'string' || args.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const trimmedName = args.displayName?.trim() ?? ''
  const displayName = trimmedName === '' ? null : trimmedName
  if (displayName !== null && [...displayName].length > MAX_DISPLAY_NAME_CODEPOINTS) {
    throw new Error(`display name must be at most ${MAX_DISPLAY_NAME_CODEPOINTS} characters`)
  }

  const { inserted } = await repo.insertAdminAccount({
    username,
    passwordHash: hashPin(args.password),
    displayName,
  })
  if (!inserted) throw new Error('username already exists')
  return { username }
}
