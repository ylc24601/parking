import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from '@/lib/supabase/server'
import type {
  EffectivePriority,
  Reservation,
  ReservationForAllocation,
  ReservationStatus,
  StaffCheckInRow,
} from '@/lib/types'

// ── Row / DTO shapes ─────────────────────────────────────────────────────────

export interface WeeklyEventRow {
  id: string
  sunday_date: string          // 'YYYY-MM-DD'
  status: string
}

// Phase 3 v2 — Staff PIN session. One shared credential row per weekly_event.
// pin_hash is service-side only and must NEVER reach any Staff DTO.
export interface StaffSessionRow {
  id: string
  weekly_event_id: string
  pin_hash: string
  expires_at: Date
  failed_attempts: number
  locked_at: Date | null
}

export interface CapacityInputs {
  weekly_event_id: string
  total_capacity: number
  blocked_spaces: number
  admin_reserved: number
  active_full_time_staff_reserved: number
}

// Payload rows handed to the apply_friday_allocation RPC.
export interface ReservationUpdate {
  id: string
  status: string
  allocation_order: number | null
  approved_at: string | null            // ISO
  release_deadline_at: string | null    // ISO
}

export interface OutboxRow {
  dedupe_key: string
  template_key: string
  user_id: string | null
  reservation_id: string | null
  payload: Record<string, unknown>
}

export interface ApplyResult {
  skipped: boolean
  updated?: number
  outbox_enqueued?: number
}

// Payload for promoting a waiting reservation into an offer / approval (sent to the
// apply_cancellation / apply_offer / apply_offer_resolution RPCs). All dates are ISO.
export interface SubstitutePayload {
  id: string
  status: 'temp_approved' | 'approved'
  offer_expires_at: string | null
  last_offer_at: string | null
  approved_at: string | null
  release_deadline_at: string | null
}

export interface CancellationResult {
  cancelled: number
  substitute_applied: number
  outbox_enqueued: number         // substitute-offer rows enqueued
  cancel_notice_enqueued: number  // confirmation rows enqueued to the cancelling member
}

export interface OfferResult {
  offered: number
  outbox_enqueued: number
}

export interface OfferResolutionResult {
  resolved: number
  next_applied: number
  outbox_enqueued: number
}

// Slice 3
export interface PenaltyCounters {
  penalty_score: number
  consecutive_no_show: number
  last_successful_attended_at: Date | null
}

export interface ReleaseResult {
  released: number
  outbox_enqueued: number        // broadcast_release rows enqueued (waiting users)
  owner_notices_enqueued: number // reservation_released rows enqueued (released owners)
}

// Penalty recovery payload for apply_attendance (null for walk-in). Dates are strings:
// last_successful_attended_at is a 'YYYY-MM-DD' (user_penalties stores a date).
export interface AttendancePenaltyPayload {
  user_id: string
  penalty_score: number
  consecutive_no_show: number
  last_successful_attended_at: string
}

export interface AttendanceResult {
  attended: number
  penalty_updated: number
}

// Slice 4
export interface SettlementPenaltyPayload {
  user_id: string
  penalty_score: number
  consecutive_no_show: number
  last_successful_attended_at: string | null   // 'YYYY-MM-DD' or null
}

export interface PastoralAlertPayload {
  user_id: string
  reason: 'consecutive_no_show'
  trigger_count: number
}

export interface SettlementResult {
  settled: number
  penalties_applied: number
  alerts_created: number
}

// Phase 4 Slice C — operation-safe aggregate health of notification_outbox (from the
// outbox_health RPC). Counts / notification-type names / sanitized error codes / timestamps
// only — no per-row or sensitive fields.
export interface OutboxHealth {
  due: number
  due_by_template: Record<string, number>
  pending: number
  retrying: number
  processing: number
  stale_processing: number
  failed: number
  failed_by_error: Record<string, number>
  sent_last_24h: number
  oldest_pending_at: string | null
  oldest_due_at: string | null     // oldest row DUE now (drives the "backlog not draining" alert)
  oldest_failed_at: string | null
  next_retry_at: string | null
}

export interface RequeueFailedResult {
  requeued: number
}

// Phase 4 Slice A — a notification_outbox row claimed by the dispatcher (already flipped
// to 'processing' and leased). line_id is joined in the claim RPC (null if the recipient
// has no LINE binding → undeliverable). Sensitive fields never leave this shape.
export interface ClaimedOutboxRow {
  id: string
  template_key: string
  user_id: string | null
  line_id: string | null
  payload_json: Record<string, unknown>
  retry_count: number
  dedupe_key: string
}

// Phase 4 Slice B — server-side resolution for a move-car request. Projects `notifiable`
// (member has a line_id) rather than the line_id itself, and coalesces the plate so a walk-in
// still resolves. Raw line_id never leaves the repo; none of this is returned to Staff.
export interface MoveCarTarget {
  weekly_event_id: string
  user_id: string | null            // null for a walk-in → not notifiable
  status: ReservationStatus
  license_plate: string | null
  notifiable: boolean               // user_id present AND that user has a bound line_id
}

const parseDate = (v: string | null | undefined): Date | null => (v ? new Date(v) : null)

// Reservation statuses surfaced on the Staff on-site check-in list (Phase 3).
export const STAFF_CHECKIN_STATUSES: ReservationStatus[] = [
  'approved',
  'released_late',
  'attended',
  'attended_after_release',
  'walk_in',
]

function rowToReservation(row: Record<string, unknown>): Reservation {
  return {
    id: row.id as string,
    weekly_event_id: row.weekly_event_id as string,
    user_id: (row.user_id as string | null) ?? null,
    vehicle_id: (row.vehicle_id as string | null) ?? null,
    requested_p2_this_week: row.requested_p2_this_week as boolean,
    effective_priority: row.effective_priority as EffectivePriority,
    status: row.status as Reservation['status'],
    offer_status: (row.offer_status as Reservation['offer_status']) ?? null,
    last_offer_at: parseDate(row.last_offer_at as string | null),
    offer_expires_at: parseDate(row.offer_expires_at as string | null),
    p2_on_the_way: row.p2_on_the_way as boolean,
    release_deadline_at: parseDate(row.release_deadline_at as string | null),
    allocation_order: (row.allocation_order as number | null) ?? null,
    applied_at: new Date(row.applied_at as string),
    approved_at: parseDate(row.approved_at as string | null),
    attended_at: parseDate(row.attended_at as string | null),
    released_at: parseDate(row.released_at as string | null),
    cancelled_at: parseDate(row.cancelled_at as string | null),
    finalized_at: parseDate(row.finalized_at as string | null),
    walk_in_name: (row.walk_in_name as string | null) ?? null,
    walk_in_license_plate: (row.walk_in_license_plate as string | null) ?? null,
    staff_note: (row.staff_note as string | null) ?? null,
    admin_note: (row.admin_note as string | null) ?? null,
  }
}

// staff_checkin_view rows are already privacy-projected (no sensitive columns to drop).
function rowToStaffCheckIn(row: Record<string, unknown>): StaffCheckInRow {
  return {
    reservation_id: row.reservation_id as string,
    weekly_event_id: row.weekly_event_id as string,
    display_name: (row.display_name as string | null) ?? null,
    license_plate: (row.license_plate as string | null) ?? null,
    walk_in_name: (row.walk_in_name as string | null) ?? null,
    walk_in_license_plate: (row.walk_in_license_plate as string | null) ?? null,
    is_priority: row.is_priority as boolean,
    status: row.status as ReservationStatus,
    attended_at: parseDate(row.attended_at as string | null),
    owner_notifiable: (row.owner_notifiable as boolean | null) ?? false,
  }
}

// Map a raw `reservations` row (a walk-in insert result) to the Staff-safe
// StaffCheckInRow whitelist. The raw row must never reach the client; this drops
// every sensitive column and exposes only name / plate / is_priority / status / time.
function rawReservationToStaffCheckIn(row: Record<string, unknown>): StaffCheckInRow {
  return {
    reservation_id: row.id as string,
    weekly_event_id: row.weekly_event_id as string,
    display_name: null,
    license_plate: null,
    walk_in_name: (row.walk_in_name as string | null) ?? null,
    walk_in_license_plate: (row.walk_in_license_plate as string | null) ?? null,
    is_priority: (row.effective_priority as number) <= 2,
    status: row.status as ReservationStatus,
    attended_at: parseDate(row.attended_at as string | null),
    owner_notifiable: false, // a walk-in has no member owner → never LINE-notifiable
  }
}

function rowToStaffSession(row: Record<string, unknown>): StaffSessionRow {
  return {
    id: row.id as string,
    weekly_event_id: row.weekly_event_id as string,
    pin_hash: row.pin_hash as string,
    expires_at: new Date(row.expires_at as string),
    failed_attempts: (row.failed_attempts as number | null) ?? 0,
    locked_at: parseDate(row.locked_at as string | null),
  }
}

function rowToReservationForAllocation(row: Record<string, unknown>): ReservationForAllocation {
  return {
    ...rowToReservation(row),
    penalty_score: (row.penalty_score as number | null) ?? 0,
    last_successful_attended_at: parseDate(row.last_successful_attended_at as string | null),
  }
}

// ── Repository ───────────────────────────────────────────────────────────────

export interface ParkingRepository {
  getWeeklyEvent(eventId: string): Promise<WeeklyEventRow>
  // Phase 3 Staff: the event the on-site page binds to. Stands in for the PIN
  // session's weekly_event_id until real Staff auth lands. Latest non-finalized
  // Sunday; null if none exists.
  getActiveEvent(): Promise<WeeklyEventRow | null>
  // Phase 3 v2: resolve a weekly_event by its Sunday date (CLI PIN provisioning).
  getWeeklyEventBySunday(sunday: string): Promise<WeeklyEventRow | null>
  // Phase 3 v2: close the week after settlement (status → 'finalized'). Idempotent
  // status-guarded write; a finalized event blocks all Staff writes.
  finalizeWeeklyEvent(eventId: string): Promise<void>
  // Phase 3 v2: operational fallback. Past weeks still 'open' (Staff forgot to
  // settle/finalize). cutoff is an exclusive YYYY-MM-DD boundary derived by the
  // caller from now − grace days; returns oldest-first.
  getStaleOpenEvents(cutoff: string): Promise<WeeklyEventRow[]>
  // Phase 3 Staff: privacy-projected check-in list for an event (reads
  // staff_checkin_view — never the raw reservations/penalty tables).
  getStaffCheckInList(eventId: string): Promise<StaffCheckInRow[]>
  // Phase 3 v2: create a walk-in reservation (status='walk_in', present now).
  // Returns the Staff-safe row, or { duplicate } on the walk_in unique-index race.
  createWalkInReservation(
    eventId: string,
    plate: string,
    name: string | null,
    nowIso: string,
  ): Promise<{ row: StaffCheckInRow } | { duplicate: true }>
  getCapacityInputs(eventId: string): Promise<CapacityInputs>
  getPendingForAllocation(eventId: string): Promise<ReservationForAllocation[]>
  applyFridayAllocation(
    eventId: string,
    jobType: string,
    reservations: ReservationUpdate[],
    outbox: OutboxRow[],
  ): Promise<ApplyResult>
  markJobFailed(eventId: string, jobType: string, message: string): Promise<void>
  // Slice 2
  getReservation(id: string): Promise<Reservation | null>
  getWaitingForSubstitution(eventId: string): Promise<Reservation[]>
  // genuine 2-hour expiries: due (offer_expires_at <= now) AND strictly before the
  // Sunday-midnight cap (rows capped at midnight belong to the auto-approve sweep).
  getExpiredOffers(eventId: string, nowIso: string, sundayMidnightIso: string): Promise<Reservation[]>
  getTempApproved(eventId: string): Promise<Reservation[]>
  applyCancellation(args: {
    eventId: string
    cancelId: string
    cancelStatus: string
    expectStatus: string
    nowIso: string
    substitute: SubstitutePayload | null
    outbox: OutboxRow[]
    cancelNotice: OutboxRow[]   // confirmation to the cancelling member (enqueued iff cancel fires)
  }): Promise<CancellationResult>
  applyOffer(eventId: string, substitute: SubstitutePayload, outbox: OutboxRow[]): Promise<OfferResult>
  applyOfferResolution(args: {
    eventId: string
    offerId: string
    outcome: 'confirmed' | 'expired' | 'declined'
    nowIso: string
    approved: { approved_at: string; release_deadline_at: string } | null
    next: SubstitutePayload | null
    outbox: OutboxRow[]
  }): Promise<OfferResolutionResult>
  // Slice 3
  getReservationsForRelease(eventId: string): Promise<Reservation[]>
  getPenaltyCounters(userId: string): Promise<PenaltyCounters>
  getP2ArrivalReminderTargets(eventId: string): Promise<Reservation[]>
  applyRelease(
    eventId: string,
    nowIso: string,
    broadcast: OutboxRow[],
    ownerNotices: OutboxRow[],
  ): Promise<ReleaseResult>
  applyAttendance(args: {
    eventId: string
    reservationId: string
    targetStatus: 'attended' | 'attended_after_release'
    nowIso: string
    penalty: AttendancePenaltyPayload | null
  }): Promise<AttendanceResult>
  // Sets p2_on_the_way + extends release_deadline_at, but only while the current deadline
  // has not yet passed (release_deadline_at >= now) and the row is still an unattended P2.
  setOnTheWay(reservationId: string, nowIso: string, releaseDeadlineIso: string): Promise<number>
  enqueueOutbox(eventId: string, rows: OutboxRow[]): Promise<number>
  // Phase 4 Slice A — notification dispatcher. claimOutbox atomically leases up to `limit`
  // due rows to `worker` (flip to 'processing'); the mark* writes are the terminal
  // transitions, each guarded on BOTH status='processing' AND locked_by=worker so a row
  // reclaimed after lease expiry is never finalized by its previous owner. last_error holds
  // a sanitized classification code only — never a raw LINE body, message text, or line_id.
  claimOutbox(worker: string, nowIso: string, limit: number, leaseSeconds: number): Promise<ClaimedOutboxRow[]>
  markOutboxSent(id: string, worker: string, sentAtIso: string): Promise<void>
  markOutboxRetry(id: string, worker: string, nextRetryAtIso: string, retryCount: number, lastErrorCode: string): Promise<void>
  markOutboxFailed(id: string, worker: string, lastErrorCode: string): Promise<void>
  // Phase 4 Slice C — operation-safe aggregate health (dryRun preview + ops visibility).
  getOutboxHealth(nowIso: string, leaseSeconds: number): Promise<OutboxHealth>
  // Phase 4 Slice F — manual-only dead-letter recovery: failed → pending (bounded, optional filter).
  requeueFailedOutbox(nowIso: string, max: number, errorCode: string | null): Promise<RequeueFailedResult>
  // Phase 4 Slice B — resolve a move-car target (owner user_id + plate + notifiability).
  // Returns null only when the reservation id doesn't exist (a walk-in still resolves).
  getMoveCarTarget(reservationId: string): Promise<MoveCarTarget | null>
  // Phase 5A — capture a pending LINE binding claim (upserts the member's active pending row).
  // Never writes users.line_id; the returned value is counts-only (no userId / code).
  capturePendingBinding(args: {
    lineUserId: string
    code: string
    eventType: string
    nowIso: string
  }): Promise<{ captured: number; superseded: boolean }>
  // Slice 4
  getReleasedLateForSettlement(eventId: string): Promise<Reservation[]>
  getPenaltyCountersForUsers(userIds: string[]): Promise<Array<{ user_id: string } & PenaltyCounters>>
  applySettlement(args: {
    eventId: string
    nowIso: string
    penalties: SettlementPenaltyPayload[]
    alerts: PastoralAlertPayload[]
  }): Promise<SettlementResult>
  // Phase 3 v2 — Staff PIN session (staff_sessions). pin_hash stays service-side.
  getStaffSessionByEvent(eventId: string): Promise<StaffSessionRow | null>
  getStaffSessionById(id: string): Promise<StaffSessionRow | null>
  resetStaffSessionFailures(id: string): Promise<void>
  applyStaffPinFailure(id: string, threshold: number): Promise<{ failed_attempts: number; locked_at: Date | null }>
  upsertStaffSessionPin(args: {
    eventId: string
    pinHash: string
    expiresAt: string          // ISO
    createdBy?: string | null
  }): Promise<void>
}

export function createParkingRepository(
  client: SupabaseClient = getServiceClient(),
): ParkingRepository {
  return {
    async getWeeklyEvent(eventId) {
      const { data, error } = await client
        .from('weekly_events')
        .select('id, sunday_date, status')
        .eq('id', eventId)
        .single()
      if (error) throw new Error(`getWeeklyEvent failed: ${error.message}`)
      return data as WeeklyEventRow
    },

    async getActiveEvent() {
      const { data, error } = await client
        .from('weekly_events')
        .select('id, sunday_date, status')
        .neq('status', 'finalized')
        .order('sunday_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`getActiveEvent failed: ${error.message}`)
      return (data as WeeklyEventRow | null) ?? null
    },

    async getWeeklyEventBySunday(sunday) {
      const { data, error } = await client
        .from('weekly_events')
        .select('id, sunday_date, status')
        .eq('sunday_date', sunday)
        .maybeSingle()
      if (error) throw new Error(`getWeeklyEventBySunday failed: ${error.message}`)
      return (data as WeeklyEventRow | null) ?? null
    },

    async finalizeWeeklyEvent(eventId) {
      const { error } = await client
        .from('weekly_events')
        .update({ status: 'finalized' })
        .eq('id', eventId)
        .neq('status', 'finalized')
      if (error) throw new Error(`finalizeWeeklyEvent failed: ${error.message}`)
    },

    async getStaleOpenEvents(cutoff) {
      const { data, error } = await client
        .from('weekly_events')
        .select('id, sunday_date, status')
        .eq('status', 'open')
        .lt('sunday_date', cutoff)
        .order('sunday_date', { ascending: true })
      if (error) throw new Error(`getStaleOpenEvents failed: ${error.message}`)
      return (data as WeeklyEventRow[]) ?? []
    },

    async getStaffCheckInList(eventId) {
      // Only statuses that need on-site handling: a held seat (approved), a
      // released seat still open to late back-fill (released_late), or an
      // already-present car (attended / after-release / walk-in). waiting /
      // pending / no_show / cancelled_* are not actionable at the entrance.
      // Stable, Staff-safe order: not-yet-arrived (attended_at null) on top, then
      // checked-in / walk-in newest→oldest. Keeps a freshly added walk-in near the
      // top after reload and partly delivers the "未點到置頂" feedback (full sort = P1.5).
      const { data, error } = await client
        .from('staff_checkin_view')
        .select('*')
        .eq('weekly_event_id', eventId)
        .in('status', STAFF_CHECKIN_STATUSES)
        .order('attended_at', { ascending: false, nullsFirst: true })
        .order('reservation_id', { ascending: true })
      if (error) throw new Error(`getStaffCheckInList failed: ${error.message}`)
      return (data ?? []).map(rowToStaffCheckIn)
    },

    async createWalkInReservation(eventId, plate, name, nowIso) {
      // walk-in semantics: on-site registration of a car that is present now → P3,
      // attended_at set. The walk_in unique index (0009) is the race backstop;
      // cross-list dedupe (incl. member plates) is handled in walkInService.
      const { data, error } = await client
        .from('reservations')
        .insert({
          weekly_event_id: eventId,
          status: 'walk_in',
          walk_in_license_plate: plate,
          walk_in_name: name,
          effective_priority: 3,
          applied_at: nowIso,
          attended_at: nowIso,
        })
        .select('id, weekly_event_id, walk_in_name, walk_in_license_plate, effective_priority, status, attended_at')
        .single()
      if (error) {
        if (error.code === '23505') return { duplicate: true }
        throw new Error(`createWalkInReservation failed: ${error.message}`)
      }
      return { row: rawReservationToStaffCheckIn(data) }
    },

    async getCapacityInputs(eventId) {
      const { data, error } = await client
        .from('v_weekly_capacity_inputs')
        .select('*')
        .eq('weekly_event_id', eventId)
        .single()
      if (error) throw new Error(`getCapacityInputs failed: ${error.message}`)
      return data as CapacityInputs
    },

    async getPendingForAllocation(eventId) {
      const { data, error } = await client
        .from('v_reservations_for_allocation')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'pending')
      if (error) throw new Error(`getPendingForAllocation failed: ${error.message}`)
      return (data ?? []).map(rowToReservationForAllocation)
    },

    async applyFridayAllocation(eventId, jobType, reservations, outbox) {
      const { data, error } = await client.rpc('apply_friday_allocation', {
        p_event_id: eventId,
        p_job_type: jobType,
        p_reservations: reservations,
        p_outbox: outbox,
      })
      if (error) throw new Error(`apply_friday_allocation failed: ${error.message}`)
      return data as ApplyResult
    },

    async markJobFailed(eventId, jobType, message) {
      const { error } = await client.from('job_runs').upsert(
        {
          weekly_event_id: eventId,
          job_type: jobType,
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: message,
        },
        { onConflict: 'weekly_event_id,job_type' },
      )
      if (error) throw new Error(`markJobFailed failed: ${error.message}`)
    },

    // ── Slice 2 ────────────────────────────────────────────────────────────────
    async getReservation(id) {
      const { data, error } = await client.from('reservations').select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(`getReservation failed: ${error.message}`)
      return data ? rowToReservation(data) : null
    },

    async getWaitingForSubstitution(eventId) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'waiting')
        .order('allocation_order', { ascending: true })
      if (error) throw new Error(`getWaitingForSubstitution failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async getExpiredOffers(eventId, nowIso, sundayMidnightIso) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'temp_approved')
        .lte('offer_expires_at', nowIso)
        .lt('offer_expires_at', sundayMidnightIso)
      if (error) throw new Error(`getExpiredOffers failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async getTempApproved(eventId) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'temp_approved')
      if (error) throw new Error(`getTempApproved failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async applyCancellation(args) {
      const { data, error } = await client.rpc('apply_cancellation', {
        p_event_id: args.eventId,
        p_cancel_id: args.cancelId,
        p_cancel_status: args.cancelStatus,
        p_expect_status: args.expectStatus,
        p_now: args.nowIso,
        p_substitute: args.substitute,
        p_outbox: args.outbox,
        p_cancel_notice: args.cancelNotice,
      })
      if (error) throw new Error(`apply_cancellation failed: ${error.message}`)
      return data as CancellationResult
    },

    async applyOffer(eventId, substitute, outbox) {
      const { data, error } = await client.rpc('apply_offer', {
        p_event_id: eventId,
        p_substitute: substitute,
        p_outbox: outbox,
      })
      if (error) throw new Error(`apply_offer failed: ${error.message}`)
      return data as OfferResult
    },

    async applyOfferResolution(args) {
      const { data, error } = await client.rpc('apply_offer_resolution', {
        p_event_id: args.eventId,
        p_offer_id: args.offerId,
        p_outcome: args.outcome,
        p_now: args.nowIso,
        p_approved: args.approved,
        p_next: args.next,
        p_outbox: args.outbox,
      })
      if (error) throw new Error(`apply_offer_resolution failed: ${error.message}`)
      return data as OfferResolutionResult
    },

    // ── Slice 3 ──────────────────────────────────────────────────────────────────
    async getReservationsForRelease(eventId) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .in('status', ['approved', 'waiting'])
      if (error) throw new Error(`getReservationsForRelease failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async getPenaltyCounters(userId) {
      const { data, error } = await client
        .from('user_penalties')
        .select('penalty_score, consecutive_no_show, last_successful_attended_at')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error(`getPenaltyCounters failed: ${error.message}`)
      return {
        penalty_score: (data?.penalty_score as number | undefined) ?? 0,
        consecutive_no_show: (data?.consecutive_no_show as number | undefined) ?? 0,
        last_successful_attended_at: parseDate(data?.last_successful_attended_at as string | null),
      }
    },

    async getP2ArrivalReminderTargets(eventId) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'approved')
        .eq('effective_priority', 2)
        .eq('p2_on_the_way', false)
        .is('attended_at', null)
      if (error) throw new Error(`getP2ArrivalReminderTargets failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async applyRelease(eventId, nowIso, broadcast, ownerNotices) {
      const { data, error } = await client.rpc('apply_release', {
        p_event_id: eventId,
        p_now: nowIso,
        p_broadcast: broadcast,
        p_owner_notices: ownerNotices,
      })
      if (error) throw new Error(`apply_release failed: ${error.message}`)
      return data as ReleaseResult
    },

    async applyAttendance(args) {
      const { data, error } = await client.rpc('apply_attendance', {
        p_event_id: args.eventId,
        p_reservation_id: args.reservationId,
        p_target_status: args.targetStatus,
        p_now: args.nowIso,
        p_penalty: args.penalty,
      })
      if (error) throw new Error(`apply_attendance failed: ${error.message}`)
      return data as AttendanceResult
    },

    async setOnTheWay(reservationId, nowIso, releaseDeadlineIso) {
      const { data, error } = await client
        .from('reservations')
        .update({ p2_on_the_way: true, release_deadline_at: releaseDeadlineIso })
        .eq('id', reservationId)
        .eq('status', 'approved')
        .eq('effective_priority', 2)
        .eq('p2_on_the_way', false)
        .is('attended_at', null)
        .gte('release_deadline_at', nowIso)
        .select('id')
      if (error) throw new Error(`setOnTheWay failed: ${error.message}`)
      return (data ?? []).length
    },

    async enqueueOutbox(eventId, rows) {
      if (rows.length === 0) return 0
      const payload = rows.map(r => ({
        dedupe_key: r.dedupe_key,
        template_key: r.template_key,
        user_id: r.user_id,
        reservation_id: r.reservation_id,
        weekly_event_id: eventId,
        payload_json: r.payload,
      }))
      const { data, error } = await client
        .from('notification_outbox')
        .upsert(payload, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(`enqueueOutbox failed: ${error.message}`)
      return (data ?? []).length
    },

    // ── Phase 4 Slice A: notification dispatcher ───────────────────────────────
    async claimOutbox(worker, nowIso, limit, leaseSeconds) {
      const { data, error } = await client.rpc('claim_notification_outbox', {
        p_worker: worker,
        p_now: nowIso,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      })
      if (error) throw new Error(`claim_notification_outbox failed: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        template_key: r.template_key as string,
        user_id: (r.user_id as string | null) ?? null,
        line_id: (r.line_id as string | null) ?? null,
        payload_json: (r.payload_json as Record<string, unknown> | null) ?? {},
        retry_count: (r.retry_count as number | null) ?? 0,
        dedupe_key: r.dedupe_key as string,
      }))
    },

    async markOutboxSent(id, worker, sentAtIso) {
      const { error } = await client
        .from('notification_outbox')
        .update({ status: 'sent', sent_at: sentAtIso, locked_at: null, locked_by: null, last_error: null })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', worker)
      if (error) throw new Error(`markOutboxSent failed: ${error.message}`)
    },

    async markOutboxRetry(id, worker, nextRetryAtIso, retryCount, lastErrorCode) {
      const { error } = await client
        .from('notification_outbox')
        .update({
          status: 'retrying',
          next_retry_at: nextRetryAtIso,
          retry_count: retryCount,
          locked_at: null,
          locked_by: null,
          last_error: lastErrorCode,
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', worker)
      if (error) throw new Error(`markOutboxRetry failed: ${error.message}`)
    },

    async markOutboxFailed(id, worker, lastErrorCode) {
      const { error } = await client
        .from('notification_outbox')
        .update({ status: 'failed', locked_at: null, locked_by: null, last_error: lastErrorCode })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', worker)
      if (error) throw new Error(`markOutboxFailed failed: ${error.message}`)
    },

    async getOutboxHealth(nowIso, leaseSeconds) {
      const { data, error } = await client.rpc('outbox_health', {
        p_now: nowIso,
        p_lease_seconds: leaseSeconds,
      })
      if (error) throw new Error(`outbox_health failed: ${error.message}`)
      return data as OutboxHealth
    },

    async requeueFailedOutbox(nowIso, max, errorCode) {
      const { data, error } = await client.rpc('requeue_failed_outbox', {
        p_now: nowIso,
        p_max: max,
        p_error_code: errorCode,
      })
      if (error) throw new Error(`requeue_failed_outbox failed: ${error.message}`)
      return data as RequeueFailedResult
    },

    async capturePendingBinding({ lineUserId, code, eventType, nowIso }) {
      const { data, error } = await client.rpc('capture_pending_binding', {
        p_line_user_id: lineUserId,
        p_code: code,
        p_event_type: eventType,
        p_now: nowIso,
      })
      if (error) throw new Error(`capture_pending_binding failed: ${error.message}`)
      const row = data as { captured: number; superseded: boolean }
      return { captured: row.captured, superseded: row.superseded }
    },

    async getMoveCarTarget(reservationId) {
      // Embed the owner (users) and vehicle via their FKs. line_id is read only to derive the
      // `notifiable` boolean here and is then discarded — it never leaves this function.
      const { data, error } = await client
        .from('reservations')
        .select('weekly_event_id, user_id, status, walk_in_license_plate, users(line_id), vehicles(license_plate)')
        .eq('id', reservationId)
        .maybeSingle()
      if (error) throw new Error(`getMoveCarTarget failed: ${error.message}`)
      if (!data) return null
      const row = data as Record<string, unknown>
      const u = row.users as { line_id: string | null } | Array<{ line_id: string | null }> | null
      const v = row.vehicles as { license_plate: string | null } | Array<{ license_plate: string | null }> | null
      const owner = Array.isArray(u) ? u[0] : u
      const vehicle = Array.isArray(v) ? v[0] : v
      const userId = (row.user_id as string | null) ?? null
      return {
        weekly_event_id: row.weekly_event_id as string,
        user_id: userId,
        status: row.status as ReservationStatus,
        license_plate: (vehicle?.license_plate ?? (row.walk_in_license_plate as string | null)) ?? null,
        notifiable: !!(userId && owner?.line_id),
      }
    },

    // ── Slice 4 ──────────────────────────────────────────────────────────────────
    async getReleasedLateForSettlement(eventId) {
      const { data, error } = await client
        .from('reservations')
        .select('*')
        .eq('weekly_event_id', eventId)
        .eq('status', 'released_late')
      if (error) throw new Error(`getReleasedLateForSettlement failed: ${error.message}`)
      return (data ?? []).map(rowToReservation)
    },

    async getPenaltyCountersForUsers(userIds) {
      if (userIds.length === 0) return []
      const { data, error } = await client
        .from('user_penalties')
        .select('user_id, penalty_score, consecutive_no_show, last_successful_attended_at')
        .in('user_id', userIds)
      if (error) throw new Error(`getPenaltyCountersForUsers failed: ${error.message}`)
      return (data ?? []).map(row => ({
        user_id: row.user_id as string,
        penalty_score: (row.penalty_score as number | null) ?? 0,
        consecutive_no_show: (row.consecutive_no_show as number | null) ?? 0,
        last_successful_attended_at: parseDate(row.last_successful_attended_at as string | null),
      }))
    },

    async applySettlement(args) {
      const { data, error } = await client.rpc('apply_settlement', {
        p_event_id: args.eventId,
        p_now: args.nowIso,
        p_penalties: args.penalties,
        p_alerts: args.alerts,
      })
      if (error) throw new Error(`apply_settlement failed: ${error.message}`)
      return data as SettlementResult
    },

    async getStaffSessionByEvent(eventId) {
      const { data, error } = await client
        .from('staff_sessions')
        .select('id, weekly_event_id, pin_hash, expires_at, failed_attempts, locked_at')
        .eq('weekly_event_id', eventId)
        .maybeSingle()
      if (error) throw new Error(`getStaffSessionByEvent failed: ${error.message}`)
      return data ? rowToStaffSession(data) : null
    },

    async getStaffSessionById(id) {
      const { data, error } = await client
        .from('staff_sessions')
        .select('id, weekly_event_id, pin_hash, expires_at, failed_attempts, locked_at')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`getStaffSessionById failed: ${error.message}`)
      return data ? rowToStaffSession(data) : null
    },

    async resetStaffSessionFailures(id) {
      const { error } = await client
        .from('staff_sessions')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', id)
      if (error) throw new Error(`resetStaffSessionFailures failed: ${error.message}`)
    },

    async applyStaffPinFailure(id, threshold) {
      const { data, error } = await client.rpc('apply_staff_pin_failure', {
        p_id: id,
        p_threshold: threshold,
      })
      if (error) throw new Error(`apply_staff_pin_failure failed: ${error.message}`)
      const row = data as { failed_attempts: number; locked_at: string | null } | null
      return {
        failed_attempts: row?.failed_attempts ?? 0,
        locked_at: parseDate(row?.locked_at ?? null),
      }
    },

    async upsertStaffSessionPin(args) {
      const { error } = await client.from('staff_sessions').upsert(
        {
          weekly_event_id: args.eventId,
          pin_hash: args.pinHash,
          expires_at: args.expiresAt,
          failed_attempts: 0,
          locked_at: null,
          created_by: args.createdBy ?? null,
        },
        { onConflict: 'weekly_event_id' },
      )
      if (error) throw new Error(`upsertStaffSessionPin failed: ${error.message}`)
    },
  }
}
