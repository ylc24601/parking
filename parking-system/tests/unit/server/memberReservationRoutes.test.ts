import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/server/services/memberReservationService', () => ({
  applyForWeek: vi.fn(),
  cancelForWeek: vi.fn(),
}))
vi.mock('@/server/http/memberAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/http/memberAuth')>()
  return { ...actual, getMemberSession: vi.fn() }
})

import { POST as applyPOST } from '@/app/api/member/reservation/apply/route'
import { POST as cancelPOST } from '@/app/api/member/reservation/cancel/route'
import { applyForWeek, cancelForWeek } from '@/server/services/memberReservationService'
import { getMemberSession } from '@/server/http/memberAuth'

const apply = (body: unknown) =>
  applyPOST(new Request('http://localhost/api/member/reservation/apply', { method: 'POST', body: JSON.stringify(body) }))

describe('member reservation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getMemberSession as Mock).mockResolvedValue({ sessionId: 's1', userId: 'u1' })
  })

  it('both routes 401 without a member session (service untouched)', async () => {
    ;(getMemberSession as Mock).mockResolvedValue(null)
    expect((await apply({ vehicleId: 'v' })).status).toBe(401)
    expect((await cancelPOST()).status).toBe(401)
    expect(applyForWeek).not.toHaveBeenCalled()
    expect(cancelForWeek).not.toHaveBeenCalled()
  })

  it('apply: 200 + no-store on success; the session user is authoritative', async () => {
    ;(applyForWeek as Mock).mockResolvedValue({ ok: true })
    const res = await apply({ vehicleId: 'veh-1', requestedP2: true, userId: 'attacker' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(applyForWeek).toHaveBeenCalledWith({ userId: 'u1', vehicleId: 'veh-1', requestedP2: true })
  })

  it('apply: business states → 200 typed; invalid_request → 400', async () => {
    ;(applyForWeek as Mock).mockResolvedValue({ ok: false, reason: 'already_applied' })
    const res = await apply({ vehicleId: 'veh-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, reason: 'already_applied' })

    ;(applyForWeek as Mock).mockResolvedValue({ ok: false, reason: 'invalid_request' })
    expect((await apply({})).status).toBe(400)
  })

  it('cancel: 200 with the cancel status; typed reasons pass through', async () => {
    ;(cancelForWeek as Mock).mockResolvedValue({ ok: true, cancelStatus: 'cancelled_late' })
    const res = await cancelPOST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelStatus: 'cancelled_late' })
    expect(cancelForWeek).toHaveBeenCalledWith({ userId: 'u1' })

    ;(cancelForWeek as Mock).mockResolvedValue({ ok: false, reason: 'offer_in_progress' })
    expect(await (await cancelPOST()).json()).toEqual({ ok: false, reason: 'offer_in_progress' })
  })
})
