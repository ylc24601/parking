import { computeApplyPriority } from '@/lib/allocation/priority'
import { taipeiToday } from '@/lib/taipeiDate'
import { cancelReservation } from '@/server/services/cancellationService'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'

// ── Member apply / cancel (Phase 7 Slice 3) ──────────────────────────────────
// The member never sends an event id or a reservation id: the server resolves
// "this week" from Taipei-local today and the member's own row from the session
// user — there is nothing to IDOR. Business rules live here / in the pure
// priority function; the RPC owns only the transactional guards.

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MemberApplyResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'invalid_request'        // malformed vehicle id
        | 'no_open_week'           // no upcoming weekly_event yet
        | 'staff_use_p1'           // full-time staff spots live in weekly_staff_allocations
        | 'event_not_open'
        | 'applications_closed'    // Friday allocation has claimed the event
        | 'vehicle_not_owned'
        | 'already_applied'
    }

export async function applyForWeek(
  params: { userId: string; vehicleId: unknown; requestedP2: unknown },
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
): Promise<MemberApplyResult> {
  const { userId } = params
  if (typeof params.vehicleId !== 'string' || !UUID_FORMAT.test(params.vehicleId)) {
    return { ok: false, reason: 'invalid_request' }
  }
  const requestedP2 = params.requestedP2 === true

  const event = await repo.getMemberEvent(taipeiToday(now))
  if (!event) return { ok: false, reason: 'no_open_week' }

  // P1 never applies through the public flow (development_plan §4): a full-time
  // staff member holds a reserved spot via weekly_staff_allocations already.
  if ((await repo.getUserRole(userId)) === 'full_time_staff') {
    return { ok: false, reason: 'staff_use_p1' }
  }

  const eligibility = await repo.getMemberEligibility(userId)
  const priority = computeApplyPriority(eligibility, requestedP2, event.sunday_date)

  const res = await repo.applyReservation({
    eventId: event.id,
    userId,
    vehicleId: params.vehicleId,
    requestedP2,
    effectivePriority: priority,
    nowIso: now.toISOString(),
  })
  if (res.applied === 1) return { ok: true }
  // The RPC's reason vocabulary is a subset of MemberApplyResult's.
  return { ok: false, reason: res.reason as 'event_not_open' | 'applications_closed' | 'vehicle_not_owned' | 'already_applied' }
}

export type MemberCancelResult =
  | { ok: true; cancelStatus: 'cancelled_by_user' | 'cancelled_late' }
  | {
      ok: false
      reason:
        | 'nothing_to_cancel'   // no live reservation this week (incl. already cancelled)
        | 'offer_in_progress'   // temp_approved: confirm/decline the offer instead (Slice 4)
        | 'cannot_cancel'       // already attended / released / settled
    }

// Cancels the member's own live reservation for this week. pending/waiting →
// cancelled_by_user; approved → cancelled_late (frees the spot; the existing
// cancellation service runs substitution + the member's confirmation notice).
export async function cancelForWeek(
  params: { userId: string },
  repo: ParkingRepository = createParkingRepository(),
  now: Date = new Date(),
  cancelFn: typeof cancelReservation = cancelReservation,
): Promise<MemberCancelResult> {
  const event = await repo.getMemberEvent(taipeiToday(now))
  if (!event) return { ok: false, reason: 'nothing_to_cancel' }

  const reservation = await repo.getMemberWeekReservation(params.userId, event.id)
  if (!reservation) return { ok: false, reason: 'nothing_to_cancel' }

  switch (reservation.status) {
    case 'pending':
    case 'waiting':
    case 'approved':
      break
    case 'temp_approved':
      return { ok: false, reason: 'offer_in_progress' }
    case 'cancelled_by_user':
    case 'cancelled_late':
      // getMemberWeekReservation prefers a live row; reaching here means the only
      // row is already cancelled — idempotent no-op.
      return { ok: false, reason: 'nothing_to_cancel' }
    default:
      return { ok: false, reason: 'cannot_cancel' }
  }

  const summary = await cancelFn({ reservationId: reservation.id, now }, repo)
  if (!summary.cancelled) return { ok: false, reason: 'nothing_to_cancel' }
  return { ok: true, cancelStatus: summary.cancelStatus }
}
