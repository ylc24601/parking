import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Thin internal job route: validate auth + limit, pass through, return an operation-safe summary.
vi.mock('@/server/http/jobAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/http/jobAuth')>()
  return { ...actual, jobSecretValid: vi.fn() }
})
vi.mock('@/server/services/notificationDispatchService', () => ({ dispatchNotifications: vi.fn() }))

import { POST } from '@/app/api/internal/jobs/dispatch-notifications/route'
import { jobSecretValid } from '@/server/http/jobAuth'
import { dispatchNotifications } from '@/server/services/notificationDispatchService'

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/internal/jobs/dispatch-notifications', {
      method: 'POST',
      headers: { 'x-job-secret': 'secret' },
      body: JSON.stringify(body),
    }),
  )

const SUMMARY = { scanned: 3, sent: 2, retried: 1, failed: 0, skippedNoLineId: 0 }

describe('POST /api/internal/jobs/dispatch-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(jobSecretValid as Mock).mockReturnValue(true)
    ;(dispatchNotifications as Mock).mockResolvedValue(SUMMARY)
  })

  it('401s when the job secret is missing/invalid', async () => {
    ;(jobSecretValid as Mock).mockReturnValue(false)
    const res = await post({})
    expect(res.status).toBe(401)
    expect(dispatchNotifications).not.toHaveBeenCalled()
  })

  it('400s on an invalid limit (non-integer / < 1), without calling the service', async () => {
    for (const limit of [0, 1.5, -1, 'ten']) {
      const res = await post({ limit })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'invalid limit' })
    }
    expect(dispatchNotifications).not.toHaveBeenCalled()
  })

  it('runs the dispatcher and returns a counts-only, operation-safe summary', async () => {
    const res = await post({})
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, ...SUMMARY })
    expect(dispatchNotifications).toHaveBeenCalledWith({ limit: undefined })
    // never leak recipient / message / penalty detail
    for (const forbidden of ['line_id', 'text', 'message', 'penalty', 'pastoral', 'phone_number', 'p2_reason']) {
      expect(JSON.stringify(json)).not.toContain(forbidden)
    }
  })

  it('passes an explicit valid limit through to the service', async () => {
    await post({ limit: 50 })
    expect(dispatchNotifications).toHaveBeenCalledWith({ limit: 50 })
  })

  it('500s when the dispatcher throws (e.g. a transport config error)', async () => {
    ;(dispatchNotifications as Mock).mockRejectedValue(new Error('invalid_transport_mode'))
    const res = await post({})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_transport_mode' })
  })
})
