import { jobSecretValid, unauthorized } from '@/server/http/jobAuth'
import { dispatchNotifications } from '@/server/services/notificationDispatchService'

// Phase 4 Slice A — internal job (behind the job secret) that drains due notification_outbox
// rows to LINE. Optional body { limit } caps the batch. Per-row failures live in the summary
// counts (not a 500); only a config error / unexpected batch throw is a 500. Response is
// operation-safe: counts only — never line_id, message text, or member/penalty detail.
export async function POST(request: Request): Promise<Response> {
  if (!jobSecretValid(request.headers.get('x-job-secret'))) return unauthorized()

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const limit = (body as { limit?: number } | null)?.limit
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return Response.json({ ok: false, error: 'invalid limit' }, { status: 400 })
  }

  try {
    const summary = await dispatchNotifications({ limit })
    return Response.json({ ok: true, ...summary })
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
