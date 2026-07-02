import { timingSafeEqual } from 'node:crypto'

// Constant-time check of the x-job-secret header against JOB_TRIGGER_SECRET.
export function jobSecretValid(provided: string | null): boolean {
  const expected = process.env.JOB_TRIGGER_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}
