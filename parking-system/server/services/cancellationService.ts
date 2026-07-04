import { buildReleaseDeadlines, buildSundayMidnight } from '@/lib/allocation/release'
import { triggerSubstitution } from '@/lib/allocation/substitute'
import {
  createParkingRepository,
  type OutboxRow,
  type ParkingRepository,
} from '@/server/repositories/parkingRepository'
import { buildSubstitutePayloadAndOutbox, offerNextSpot } from './substitution'

export interface CancelSummary {
  cancelStatus: 'cancelled_by_user' | 'cancelled_late'
  cancelled: boolean
  substituteOffered: boolean
  substituteReservationId: string | null
  confirmationEnqueued: boolean   // cancel-confirmation notice queued to the cancelling member
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

  // Already cancelled → idempotent no-op (re-running a cancel must not error). Returns without
  // calling the RPC, so no confirmation is (re-)enqueued.
  if (r.status === 'cancelled_by_user' || r.status === 'cancelled_late') {
    return {
      cancelStatus: r.status, cancelled: false, substituteOffered: false,
      substituteReservationId: null, confirmationEnqueued: false,
    }
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

  // Member self-cancellation confirmation to the cancelling member. Once-per-reservation dedupe
  // (a reservation is cancelled once). The stored cancel_status is authoritative from the RPC's
  // `cancelled` CTE, so the payload here is empty; the RPC only enqueues it if the cancel fires.
  const cancelNotice: OutboxRow[] = r.user_id
    ? [{
        dedupe_key: `cancel_notice:${r.id}`,
        template_key: 'reservation_cancelled',
        user_id: r.user_id,
        reservation_id: r.id,
        payload: {},
      }]
    : []

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
      cancelNotice,
    })
    return {
      cancelStatus, cancelled: res.cancelled > 0, substituteOffered: false,
      substituteReservationId: null, confirmationEnqueued: res.cancel_notice_enqueued > 0,
    }
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
      nowIso: now.toISOString(), substitute: null, outbox: [], cancelNotice,
    })
    return {
      cancelStatus, cancelled: res.cancelled > 0, substituteOffered: false,
      substituteReservationId: null, confirmationEnqueued: res.cancel_notice_enqueued > 0,
    }
  }

  // Atomic cancel + first offer.
  excluded.add(firstSub.reservation.id)
  const { payload, outbox } = buildSubstitutePayloadAndOutbox(firstSub, now, deadlines)
  const res = await repo.applyCancellation({
    eventId: r.weekly_event_id, cancelId: r.id, cancelStatus, expectStatus: 'approved',
    nowIso: now.toISOString(), substitute: payload, outbox, cancelNotice,
  })

  if (res.cancelled === 0) {
    // Concurrent cancel already handled this reservation.
    return {
      cancelStatus, cancelled: false, substituteOffered: false,
      substituteReservationId: null, confirmationEnqueued: false,
    }
  }
  // The confirmation was enqueued (or deduped) by the cancel above, regardless of substitute outcome.
  const confirmationEnqueued = res.cancel_notice_enqueued > 0
  if (res.substitute_applied > 0) {
    return {
      cancelStatus, cancelled: true, substituteOffered: true,
      substituteReservationId: firstSub.reservation.id, confirmationEnqueued,
    }
  }

  // Race: chosen candidate was taken; cancel already committed → offer-only retry.
  const offeredId = await offerNextSpot(repo, r.weekly_event_id, now, sundayMidnight, deadlines, excluded)
  return {
    cancelStatus, cancelled: true, substituteOffered: !!offeredId,
    substituteReservationId: offeredId, confirmationEnqueued,
  }
}
