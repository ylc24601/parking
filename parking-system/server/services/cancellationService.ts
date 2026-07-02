import { buildReleaseDeadlines, buildSundayMidnight } from '@/lib/allocation/release'
import { triggerSubstitution } from '@/lib/allocation/substitute'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import { buildSubstitutePayloadAndOutbox, offerNextSpot } from './substitution'

export interface CancelSummary {
  cancelStatus: 'cancelled_by_user' | 'cancelled_late'
  cancelled: boolean
  substituteOffered: boolean
  substituteReservationId: string | null
}

// Cancel a reservation. pending/waiting → cancelled_by_user (no spot freed).
// approved → cancelled_late, which frees a spot and offers it down the waiting list.
export async function cancelReservation(
  params: { reservationId: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<CancelSummary> {
  const { reservationId, now = new Date() } = params
  const r = await repo.getReservation(reservationId)
  if (!r) throw new Error(`reservation ${reservationId} not found`)

  // Already cancelled → idempotent no-op (re-running a cancel must not error).
  if (r.status === 'cancelled_by_user' || r.status === 'cancelled_late') {
    return { cancelStatus: r.status, cancelled: false, substituteOffered: false, substituteReservationId: null }
  }

  let cancelStatus: 'cancelled_by_user' | 'cancelled_late'
  let needsSubstitution = false
  if (r.status === 'approved') {
    cancelStatus = 'cancelled_late'
    needsSubstitution = true
  } else if (r.status === 'pending' || r.status === 'waiting') {
    cancelStatus = 'cancelled_by_user'
  } else {
    throw new Error(`cannot cancel reservation in status '${r.status}'`)
  }

  // No spot freed → plain cancel.
  if (!needsSubstitution) {
    const res = await repo.applyCancellation({
      eventId: r.weekly_event_id,
      cancelId: r.id,
      cancelStatus,
      expectStatus: r.status,
      nowIso: now.toISOString(),
      substitute: null,
      outbox: [],
    })
    return { cancelStatus, cancelled: res.cancelled > 0, substituteOffered: false, substituteReservationId: null }
  }

  // approved → cancel + offer the freed spot.
  const event = await repo.getWeeklyEvent(r.weekly_event_id)
  const sundayMidnight = buildSundayMidnight(event.sunday_date)
  const deadlines = buildReleaseDeadlines(event.sunday_date)
  const excluded = new Set<string>()

  const waiting = await repo.getWaitingForSubstitution(r.weekly_event_id)
  const firstSub = triggerSubstitution(waiting, now, sundayMidnight)

  // No one waiting → just cancel.
  if (!firstSub) {
    const res = await repo.applyCancellation({
      eventId: r.weekly_event_id, cancelId: r.id, cancelStatus, expectStatus: 'approved',
      nowIso: now.toISOString(), substitute: null, outbox: [],
    })
    return { cancelStatus, cancelled: res.cancelled > 0, substituteOffered: false, substituteReservationId: null }
  }

  // Atomic cancel + first offer.
  excluded.add(firstSub.reservation.id)
  const { payload, outbox } = buildSubstitutePayloadAndOutbox(firstSub, now, deadlines)
  const res = await repo.applyCancellation({
    eventId: r.weekly_event_id, cancelId: r.id, cancelStatus, expectStatus: 'approved',
    nowIso: now.toISOString(), substitute: payload, outbox,
  })

  if (res.cancelled === 0) {
    // Concurrent cancel already handled this reservation.
    return { cancelStatus, cancelled: false, substituteOffered: false, substituteReservationId: null }
  }
  if (res.substitute_applied > 0) {
    return { cancelStatus, cancelled: true, substituteOffered: true, substituteReservationId: firstSub.reservation.id }
  }

  // Race: chosen candidate was taken; cancel already committed → offer-only retry.
  const offeredId = await offerNextSpot(repo, r.weekly_event_id, now, sundayMidnight, deadlines, excluded)
  return { cancelStatus, cancelled: true, substituteOffered: !!offeredId, substituteReservationId: offeredId }
}
