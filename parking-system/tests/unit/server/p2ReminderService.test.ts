import { describe, expect, it, vi } from 'vitest'
import { sendArrivalReminders } from '@/server/services/p2ReminderService'
import type { OutboxRow } from '@/server/repositories/parkingRepository'
import { asRepo, makeMockRepo } from './mockRepo'
import { makeReservation, T } from '../allocation/helpers'

const EVENT = 'event-1'

describe('sendArrivalReminders', () => {
  it('enqueues one p2_arrival_reminder per target with a stable per-event dedupe key', async () => {
    const a = makeReservation({ status: 'approved', effective_priority: 2, weekly_event_id: EVENT })
    const b = makeReservation({ status: 'approved', effective_priority: 2, weekly_event_id: EVENT })
    const repo = makeMockRepo({
      getP2ArrivalReminderTargets: vi.fn(async () => [a, b]),
      enqueueOutbox: vi.fn(async () => 2),
    })

    const summary = await sendArrivalReminders({ eventId: EVENT, now: T.SUN_1000 }, asRepo(repo))

    expect(summary.enqueued).toBe(2)
    const [eventId, rows] = repo.enqueueOutbox.mock.calls[0] as [string, OutboxRow[]]
    expect(eventId).toBe(EVENT)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.template_key === 'p2_arrival_reminder')).toBe(true)
    expect(rows[0].dedupe_key).toBe(`p2_reminder:${a.id}:2026-06-21`)
    expect(rows[1].dedupe_key).toBe(`p2_reminder:${b.id}:2026-06-21`)
  })

  it('no targets → enqueues nothing', async () => {
    const repo = makeMockRepo({ getP2ArrivalReminderTargets: vi.fn(async () => []) })
    const summary = await sendArrivalReminders({ eventId: EVENT, now: T.SUN_1000 }, asRepo(repo))
    expect(summary.enqueued).toBe(0)
    expect(repo.enqueueOutbox.mock.calls[0][1]).toHaveLength(0)
  })
})
