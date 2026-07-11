import { adminUnauthorized, getAdminSession } from '@/server/http/adminAuth'
import { adminInternalError, guardAdminPost } from '@/server/http/adminRequestGuard'
import { setAdminDisabled } from '@/server/services/adminAccountService'

// Disable or re-enable another admin account. actingAdminId is taken from the
// SESSION — any actingAdminId in the body is ignored. Self-target is refused (403)
// so an operator can never lock themselves out; the last active admin cannot be
// disabled (409) so the account list can never reach zero enabled admins via this
// route. Both directions revoke the target's sessions (see migration 0026 — this
// forces re-login even on re-enable, closing a stale-cookie-revival hazard).
const NO_STORE = { 'cache-control': 'no-store' }

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request): Promise<Response> {
  const guard = await guardAdminPost(request)
  if (!guard.ok) return guard.response
  const session = await getAdminSession()
  if (!session) return adminUnauthorized()

  const { targetId, disabled } = (guard.body ?? {}) as { targetId?: unknown; disabled?: unknown }
  if (typeof targetId !== 'string' || !UUID_FORMAT.test(targetId)) {
    return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400, headers: NO_STORE })
  }
  if (typeof disabled !== 'boolean') {
    return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400, headers: NO_STORE })
  }

  let result
  try {
    result = await setAdminDisabled({ targetId, actingAdminId: session.adminId, disabled })
  } catch (e) {
    console.error('admin account disable error')
    void e
    return adminInternalError()
  }

  if (result.ok) {
    return Response.json({ ok: true }, { headers: NO_STORE })
  }
  const status =
    result.reason === 'not_found' ? 404 : result.reason === 'cannot_target_self' ? 403 : 409 // last_active_admin
  return Response.json({ ok: false, reason: result.reason }, { status, headers: NO_STORE })
}
