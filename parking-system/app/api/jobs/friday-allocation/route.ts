import { timingSafeEqual } from 'node:crypto'
import { runFridayAllocation } from '@/server/services/fridayAllocationService'

// Thin entry point: validate a shared job secret, then delegate to the service.
// Future-compatible with Supabase cron / Vercel cron / manual POST (all send the
// x-job-secret header). Unsupported HTTP methods auto-return 405 in Next.

function secretValid(provided: string | null): boolean {
  const expected = process.env.JOB_TRIGGER_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<Response> {
  if (!secretValid(request.headers.get('x-job-secret'))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const eventId = (body as { eventId?: string } | null)?.eventId
  if (!eventId) {
    return Response.json({ ok: false, error: 'eventId is required' }, { status: 400 })
  }

  try {
    const summary = await runFridayAllocation({ eventId })
    return Response.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
