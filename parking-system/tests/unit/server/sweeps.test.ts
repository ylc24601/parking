import { describe, expect, it, vi } from 'vitest'
import { expireOffers } from '@/server/services/offerExpiryService'
import { autoApproveTemp } from '@/server/services/autoApproveService'
import { buildReleaseDeadlines } from '@/lib/allocation/release'
import { asRepo, makeMockRepo } from './mockRepo'
import { makeReservation } from '../allocation/helpers'

const EVENT = 'event-1'
const NOW_PRE = new Date('2026-06-20T13:00:00Z')   // before Sunday midnight
const NOW_POST = new Date('2026-06-20T16:01:00Z')  // after Sunday midnight
const deadlines = buildReleaseDeadlines('2026-06-21')
const vi_fn = (v: unknown) => vi.fn(async () => v)

const tempOffer = () => makeReservation({ status: 'temp_approved', weekly_event_id: EVENT, effective_priority: 3 })
const waiting = (order: number) =>
  makeReservation({ status: 'waiting', weekly_event_id: EVENT, effective_priority: 3, allocation_order: order })

describe('expireOffers', () => {
  it('expires a due offer and offers the freed spot to the next candidate', async () => {
    const off = tempOffer()
    const w2 = waiting(3)
    const repo = makeMockRepo({
      getExpiredOffers: vi_fn([off]),
      getWaitingForSubstitution: vi_fn([w2]),
      applyOfferResolution: vi.fn(async () => ({ resolved: 1, next_applied: 1, outbox_enqueued: 1, expired_blocked: false })),
    })
    const summary = await expireOffers({ eventId: EVENT, now: NOW_PRE }, asRepo(repo))

    expect(summary.expired).toBe(1)
    expect(summary.offered).toBe(1)
    const arg = repo.applyOfferResolution.mock.calls[0][0]
    expect(arg.outcome).toBe('expired')
    expect(arg.next.id).toBe(w2.id)
  })

  it('race retry does NOT re-offer the just-expired row', async () => {
    const off = tempOffer()
    const offAsWaiting = { ...off, status: 'waiting' as const }
    const w2 = waiting(3)
    const w3 = waiting(4)
    const getWaiting = vi.fn()
    getWaiting.mockResolvedValueOnce([w2])
    getWaiting.mockResolvedValue([offAsWaiting, w3])
    const repo = makeMockRepo({
      getExpiredOffers: vi_fn([off]),
      getWaitingForSubstitution: getWaiting,
      applyOfferResolution: vi.fn(async () => ({ resolved: 1, next_applied: 0, outbox_enqueued: 0, expired_blocked: false })),
      applyOffer: vi.fn(async () => ({ offered: 1, outbox_enqueued: 1 })),
    })
    const summary = await expireOffers({ eventId: EVENT, now: NOW_PRE }, asRepo(repo))

    expect(summary.offered).toBe(1)
    const offeredId = repo.applyOffer.mock.calls[0][1].id
    expect(offeredId).toBe(w3.id)
    expect(offeredId).not.toBe(off.id)
    expect(offeredId).not.toBe(w2.id)
  })

  it('passes the Sunday-midnight bound to getExpiredOffers', async () => {
    const repo = makeMockRepo({ getExpiredOffers: vi_fn([]) })
    await expireOffers({ eventId: EVENT, now: NOW_PRE }, asRepo(repo))
    const [, nowIso, midnightIso] = repo.getExpiredOffers.mock.calls[0]
    expect(nowIso).toBe(NOW_PRE.toISOString())
    expect(midnightIso).toBe('2026-06-20T16:00:00.000Z')
  })
})

describe('autoApproveTemp', () => {
  it('after midnight: upgrades temp_approved → approved with an offer_auto_approved outbox', async () => {
    const t = tempOffer() // P3
    const repo = makeMockRepo({
      getTempApproved: vi_fn([t]),
      applyOfferResolution: vi.fn(async () => ({ resolved: 1, next_applied: 0, outbox_enqueued: 1, expired_blocked: false })),
    })
    const summary = await autoApproveTemp({ eventId: EVENT, now: NOW_POST }, asRepo(repo))

    expect(summary.approved).toBe(1)
    const arg = repo.applyOfferResolution.mock.calls[0][0]
    expect(arg.outcome).toBe('confirmed')
    expect(arg.approved.release_deadline_at).toBe(deadlines.p3.toISOString())
    expect(arg.outbox[0].dedupe_key).toBe(`auto_approved:${t.id}`)
    expect(arg.outbox[0].template_key).toBe('offer_auto_approved')
  })

  it('before midnight: no-op', async () => {
    const repo = makeMockRepo({ getTempApproved: vi_fn([tempOffer()]) })
    const summary = await autoApproveTemp({ eventId: EVENT, now: NOW_PRE }, asRepo(repo))
    expect(summary.approved).toBe(0)
    expect(repo.applyOfferResolution).not.toHaveBeenCalled()
  })
})
