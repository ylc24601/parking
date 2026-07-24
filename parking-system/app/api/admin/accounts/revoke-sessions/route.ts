import { can } from '@/lib/adminRoles'
import { adminForbidden, adminUnauthorized, getAdminSession } from '@/server/http/adminAuth'
import { adminInternalError, guardAdminPost } from '@/server/http/adminRequestGuard'
import { ADMIN_ACCOUNT_ACTION_STATUS, revokeAdminSessions } from '@/server/services/adminAccountService'

// Force-log-out every device of another admin account without changing its
// disabled/password state. actingAdminId is taken from the SESSION; self-target
// is refused (403). Superadmin-only (2C-1 / #19).
//
// ⚠️ Unlike its two neighbours this one is still a plain repository DELETE, so it
// writes NO audit row — a named follow-up, not an oversight: making it audited means
// a new RPC, and the gap predates roles.
const NO_STORE = { 'cache-control': 'no-store' }

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request): Promise<Response> {
  const guard = await guardAdminPost(request)
  if (!guard.ok) return guard.response
  const session = await getAdminSession()
  if (!session) return adminUnauthorized()
  if (!can(session.role, 'manage_admin_accounts')) return adminForbidden()

  const { targetId } = (guard.body ?? {}) as { targetId?: unknown }
  if (typeof targetId !== 'string' || !UUID_FORMAT.test(targetId)) {
    return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400, headers: NO_STORE })
  }

  let result
  try {
    result = await revokeAdminSessions({ targetId, actingAdminId: session.adminId })
  } catch (e) {
    console.error('admin account revoke-sessions error')
    void e
    return adminInternalError()
  }

  if (result.ok) {
    return Response.json({ ok: true }, { headers: NO_STORE })
  }
  const status = ADMIN_ACCOUNT_ACTION_STATUS[result.reason]
  return Response.json({ ok: false, reason: result.reason }, { status, headers: NO_STORE })
}
