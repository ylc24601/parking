import {
  createParkingRepository,
  type OutboxRow,
  type ParkingRepository,
} from '@/server/repositories/parkingRepository'

export interface P2ReminderSummary {
  enqueued: number
}

// 10:20 cron: remind approved P2 members who have not yet arrived to come (or reply
// 「正在路上」). Targets exclude anyone already on the way (p2_on_the_way=true) and the
// already-arrived (attended_at not null). Dedupe key is per reservation per event, so the
// sweep is safely repeatable (one reminder per P2 per Sunday).
export async function sendArrivalReminders(
  params: { eventId: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<P2ReminderSummary> {
  const { eventId } = params
  const event = await repo.getWeeklyEvent(eventId)
  const targets = await repo.getP2ArrivalReminderTargets(eventId)

  const rows: OutboxRow[] = targets.map(t => ({
    dedupe_key: `p2_reminder:${t.id}:${event.sunday_date}`,
    template_key: 'p2_arrival_reminder',
    user_id: t.user_id,
    reservation_id: t.id,
    payload: { sunday_date: event.sunday_date },
  }))

  const enqueued = await repo.enqueueOutbox(eventId, rows)
  return { enqueued }
}
