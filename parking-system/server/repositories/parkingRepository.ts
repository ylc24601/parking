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

// Phase 7 Slice 2 — raw pending-claim row for the admin review queue. Contains raw
// code/phone/name: repo consumers must be the service layer, which masks them.
export interface PendingBindingListRow {
  id: string
  claim_source: string
  submitted_code: string | null
  claimed_phone: string | null
  claimed_name: string | null
  created_at: string
  last_submitted_at: string
  superseded_count: number
}

// Phase 7 Slice 1 — member LIFF session. The cookie token itself is never stored;
// token_hash is its sha256 (see server/http/sessionToken.ts).
export interface MemberSessionRow {
  id: string
  user_id: string
  expires_at: Date
}

// Phase 8 Slice 1 — Admin UI operator account. password_hash stays service-side
// (verifyPin); it must never be copied into any DTO or response.
export interface AdminAccountRow {
  id: string
  username: string
  password_hash: string
  failed_attempts: number
  locked_at: Date | null
  disabled_at: Date | null
}

// Phase 8 Slice 1 — admin session joined with its account so the auth layer can kill
// live sessions of a disabled account on every request.
export interface AdminSessionRow {
  id: string
  admin_id: string
  expires_at: Date
  username: string
  account_disabled_at: Date | null
}

// Phase 8 Slice 3 — admin account list row. Deliberately omits password_hash and
// failed_attempts (the account-management UI never needs either).
export interface AdminAccountListRow {
  id: string
  username: string
  display_name: string | null
  locked_at: Date | null
  disabled_at: Date | null
  created_at: Date
}

// Phase 8 Slice 2 — admin member search result (raw; the SERVICE masks phone before
// output). plates are the member's ACTIVE license plates only.
export interface MemberSearchRow {
  id: string
  display_name: string
  phone_number: string | null
  role: string
  line_id: string | null
  plates: string[]
}

// Phase 8 Slice 2 — full admin member detail. Contains complete PII (phone/plates/
// eligibility/dependents); only the session-gated detail page renders it and the
// service DTO drops line_id in favour of a `bound` boolean.
export interface MemberAdminDetailRow {
  display_name: string
  phone_number: string | null
  role: string
  line_id: string | null
  vehicles: Array<{ license_plate: string; nickname: string | null }>
  eligibility: {
    p2_eligible: boolean
    p2_reason: string | null
    p2_valid_until: string | null
    p2_review_date: string | null
    reviewed_at: string | null
  } | null
  dependents: Array<{ kind: string; name: string; birthdate: string | null }>
}

// Phase 7 Slice 1 — the member's own reservation for one week, plate joined.
// Member-safe projection: own data only, no penalty/eligibility fields. `id`,
// `effective_priority` and `attended_at` are for server-side actions/affordance
// flags (cancel, offer, on-the-way) and must never be copied into a client DTO.
export interface MemberWeekReservationRow {
  id: string
  status: ReservationStatus
  effective_priority: number
  license_plate: string | null
  applied_at: Date
  attended_at: Date | null
  release_deadline_at: Date | null
  offer_expires_at: Date | null
  p2_on_the_way: boolean
}

// Phase 7 Slice 3 — a member's active vehicle for the apply form.
export interface MemberVehicleRow {
  id: string
  license_plate: string
  nickname: string | null
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
  // expiryGuard only: resolved=0 because the offer had expired (vs not temp_approved).
  expired_blocked: boolean
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
    // member path only: refuse confirm/decline once offer_expires_at <= now, inside
    // the atomic write. Ops sweeps omit it (auto-approve confirms past the cap).
    expiryGuard?: boolean
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
  // Phase 5B — approve/reject a captured pending binding. Addressed BY pending id; the raw
  // line_user_id / submitted_code never cross this surface. Results are typed + counts-only.
  // Phase 7 Slice 2: expectedSupersededCount is the revision the admin previewed (bumped on every
  // capture upsert — a caller-supplied timestamp could collide) — REQUIRED for an apply
  // (mismatch → 'pending_changed'); pass null/omit for a dry-run.
  // Phase 8 Slice 1: adminId (Admin-UI decider, from the session — never from a request
  // body) lands in pending_binding.decided_by_admin_id; CLI callers omit it → null.
  approvePendingBinding(args: {
    pendingId: string
    nowIso: string
    dryRun: boolean
    expectedSupersededCount?: number | null
    adminId?: string | null
  }): Promise<{ approved: number; would_approve: boolean; reason: string }>
  // Phase 7 Slice 2 — verified-identity LIFF claim capture (upsert of the account's active
  // pending row). Counts-only; the claim payload never comes back.
  captureLiffBindingClaim(args: {
    lineUserId: string
    phone: string
    name: string
    nowIso: string
  }): Promise<{ captured: number; superseded: boolean }>
  // Phase 7 Slice 2 — raw pending-claim rows for the admin list (FIFO by last_submitted_at).
  // The SERVICE masks code/phone before output; raw values never leave the service layer.
  listPendingBindings(limit: number): Promise<PendingBindingListRow[]>
  rejectPendingBinding(args: {
    pendingId: string
    reason: string
    nowIso: string
    adminId?: string | null
  }): Promise<{ rejected: number; reason: string }>
  // Phase 5B Slice 2 — issue a binding code. `inserted:false` iff the code already exists (unique
  // conflict) so the caller can regenerate; other DB errors throw.
  insertBindingCode(args: {
    code: string
    userId: string
    expiresAtIso: string
    createdBy?: string | null
    note?: string | null
  }): Promise<{ inserted: boolean }>
  // Phase 5B Slice 2 — resolve a member's display name (issue validation + confirmation). Null if
  // the user id doesn't exist.
  getUserDisplayName(userId: string): Promise<string | null>
  // Phase 6 — atomic upsert of one member (by phone) + vehicles + eligibility + dependents. Typed,
  // dry-run aware. line_id is never touched.
  importMember(args: {
    name: string
    phone: string
    plates: string[]
    reason: string
    validUntil: string | null
    reviewDate: string | null
    dependents: Array<{ kind: string; name: string; birthdate: string | null }>
    dryRun: boolean
  }): Promise<{
    status: 'imported' | 'updated' | 'phone_name_conflict'
    existing_name?: string
    vehicles_added?: number
    dependents_added?: number
    plate_conflicts?: string[]
  }>
  // Phase 5B Slice 2 — raw fields for the approve preview (the SERVICE masks them before output;
  // they are never printed/logged raw). Returns null only when the pending id doesn't exist.
  // Phase 7 Slice 2: also carries the claim source/fields + superseded_count (the optimistic-
  // concurrency revision; last_submitted_at is display/audit only); liff claims resolve the
  // matched member by canonical phone.
  getBindingApprovalPreview(pendingId: string): Promise<{
    pending_status: string
    claim_source: string
    line_user_id: string
    submitted_code: string | null
    claimed_phone: string | null
    claimed_name: string | null
    superseded_count: number
    last_submitted_at: string
    matched_user_id: string | null
    matched_display_name: string | null
  } | null>
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
  // Phase 7 Slice 1 — member LIFF auth + read-only week status. Raw line_id never
  // leaves the repo surface beyond this lookup's input.
  getUserByLineId(lineUserId: string): Promise<{ id: string; display_name: string } | null>
  createMemberSession(args: { userId: string; tokenHash: string; expiresAt: string }): Promise<void>
  getMemberSessionByTokenHash(tokenHash: string): Promise<MemberSessionRow | null>
  deleteMemberSessionByTokenHash(tokenHash: string): Promise<void>
  // Lazy cleanup at login: drop the member's already-expired session rows.
  deleteExpiredMemberSessions(userId: string, nowIso: string): Promise<void>
  // Phase 8 Slice 1 — Admin UI accounts + sessions (admin_accounts / admin_sessions).
  // password_hash never leaves the service layer; session lookups join the account so
  // disabled_at can evict live sessions.
  getAdminAccountByUsername(username: string): Promise<AdminAccountRow | null>
  // `inserted:false` iff the username already exists (unique conflict); other errors throw.
  insertAdminAccount(args: {
    username: string
    passwordHash: string
    displayName?: string | null
  }): Promise<{ inserted: boolean }>
  resetAdminLoginFailures(id: string): Promise<void>
  // Atomic lock-cycle counter (apply_admin_login_failure, 0025): active lock → no-op,
  // expired lock → new round at 1, else increment; threshold sets locked_at = now.
  applyAdminLoginFailure(args: {
    id: string
    nowIso: string
    threshold: number
    lockMinutes: number
  }): Promise<{ failed_attempts: number; locked_at: Date | null }>
  createAdminSession(args: { adminId: string; tokenHash: string; expiresAt: string }): Promise<void>
  getAdminSessionByTokenHash(tokenHash: string): Promise<AdminSessionRow | null>
  deleteAdminSessionByTokenHash(tokenHash: string): Promise<void>
  deleteExpiredAdminSessions(adminId: string, nowIso: string): Promise<void>
  // Phase 8 Slice 3 — admin account management. The two state-changing operations
  // below wrap single atomic RPCs (0026): see that migration for why a sequence of
  // separate repo calls is not safe here (partial-failure session/credential
  // inconsistency on an offboarding security surface).
  getAdminAccountById(id: string): Promise<AdminAccountRow | null>
  listAdminAccounts(): Promise<AdminAccountListRow[]>
  // Wraps set_admin_disabled (0026): atomic self-guard + last-active invariant
  // (when disabling) + session revoke (on BOTH disable and enable — re-enabling
  // also forces re-login so a missed session-delete during a prior disable can't
  // let a stale cookie come back to life).
  setAdminDisabled(args: {
    targetId: string
    actingAdminId: string
    disabled: boolean
    nowIso: string
  }): Promise<{ ok: boolean; reason?: string }>
  // Wraps reset_admin_password (0026): atomic hash update + failed_attempts/locked_at
  // clear + session revoke. Receives only the already-hashed password; never sees
  // or returns plaintext. Leaves disabled_at untouched.
  resetAdminPassword(args: {
    targetId: string
    actingAdminId: string
    passwordHash: string
  }): Promise<{ ok: boolean; reason?: string; username?: string; disabled?: boolean }>
  // Single-table, single-statement — already atomic without an RPC.
  deleteAdminSessionsByAdminId(id: string): Promise<{ deleted: number }>
  // The member-facing "this week": smallest sunday_date >= todayTaipei (any status),
  // NOT getActiveEvent's "latest non-finalized" (that is Staff-PIN semantics and
  // points wrong once future weeks are pre-created).
  getMemberEvent(todayTaipei: string): Promise<WeeklyEventRow | null>
  // The member's own reservation for one event; the live row wins over cancelled
  // ones (the one-active-per-member index allows cancelled siblings).
  getMemberWeekReservation(userId: string, eventId: string): Promise<MemberWeekReservationRow | null>
  // Phase 7 Slice 3 — member apply/cancel.
  getMemberVehicles(userId: string): Promise<MemberVehicleRow[]>
  // Sensitive: eligibility stays server-side; only derived bits (priority, companion
  // hint) may reach the client.
  getMemberEligibility(userId: string): Promise<{
    p2_eligible: boolean
    p2_reason: string | null
    p2_valid_until: string | null
  } | null>
  getUserRole(userId: string): Promise<string | null>
  // Phase 8 Slice 2 — admin member search. The service pre-splits/cleans the raw query
  // into three OPTIONAL cleaned branches (null = skip that branch); this method runs
  // only the non-null ones (each capped), merges distinct users, attaches ACTIVE plates,
  // and returns a stable-sorted list. Masking happens in the service.
  searchMembers(args: {
    nameQuery: string | null
    phoneQuery: string | null
    plateQuery: string | null
    candidateCap: number
  }): Promise<MemberSearchRow[]>
  // Phase 8 Slice 2 — full admin member detail (raw PII). Null if the user doesn't exist.
  getMemberAdminDetail(userId: string): Promise<MemberAdminDetailRow | null>
  // Apply window: closed once the Friday allocation job has claimed the event
  // ('running' or 'success' — rows inserted mid-run would miss the batch).
  hasFridayAllocationRun(eventId: string): Promise<boolean>
  // Atomic member apply (RPC): typed, never throws for business states.
  applyReservation(args: {
    eventId: string
    userId: string
    vehicleId: string
    requestedP2: boolean
    effectivePriority: 2 | 3
    nowIso: string
  }): Promise<{ applied: number; reason: string }>
  // Claim the event's allocation run UNDER the weekly_events row lock (the allocator's
  // half of the apply-window protocol) — must COMMIT before the pending snapshot is read.
  claimFridayAllocation(eventId: string, jobType: string): Promise<{ claimed: boolean; reason: string }>
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
        p_expiry_guard: args.expiryGuard ?? false,
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

    async approvePendingBinding({ pendingId, nowIso, dryRun, expectedSupersededCount, adminId }) {
      const { data, error } = await client.rpc('approve_pending_binding', {
        p_pending_id: pendingId,
        p_expected_superseded_count: expectedSupersededCount ?? null,
        p_now: nowIso,
        p_dry_run: dryRun,
        p_admin_id: adminId ?? null,
      })
      if (error) throw new Error(`approve_pending_binding failed: ${error.message}`)
      return data as { approved: number; would_approve: boolean; reason: string }
    },

    async captureLiffBindingClaim({ lineUserId, phone, name, nowIso }) {
      const { data, error } = await client.rpc('capture_liff_binding_claim', {
        p_line_user_id: lineUserId,
        p_phone: phone,
        p_name: name,
        p_now: nowIso,
      })
      // Sanitized: the message never echoes the claim payload (RPC params aren't in it).
      if (error) throw new Error(`capture_liff_binding_claim failed: ${error.message}`)
      const row = data as { captured: number; superseded: boolean }
      return { captured: row.captured, superseded: row.superseded }
    },

    async listPendingBindings(limit) {
      const { data, error } = await client
        .from('pending_binding')
        .select('id, claim_source, submitted_code, claimed_phone, claimed_name, created_at, last_submitted_at, superseded_count')
        .eq('status', 'pending')
        .order('last_submitted_at', { ascending: true })   // FIFO review queue
        .order('id', { ascending: true })
        .limit(limit)
      if (error) throw new Error(`listPendingBindings failed: ${error.message}`)
      return (data ?? []) as PendingBindingListRow[]
    },

    async rejectPendingBinding({ pendingId, reason, nowIso, adminId }) {
      const { data, error } = await client.rpc('reject_pending_binding', {
        p_pending_id: pendingId,
        p_reason: reason,
        p_now: nowIso,
        p_admin_id: adminId ?? null,
      })
      if (error) throw new Error(`reject_pending_binding failed: ${error.message}`)
      return data as { rejected: number; reason: string }
    },

    async insertBindingCode({ code, userId, expiresAtIso, createdBy = null, note = null }) {
      const { error } = await client.from('binding_codes').insert({
        code, user_id: userId, expires_at: expiresAtIso, created_by: createdBy, note,
      })
      if (error) {
        if (error.code === '23505') return { inserted: false } // unique code conflict → caller regenerates
        throw new Error(`insertBindingCode failed: ${error.message}`)
      }
      return { inserted: true }
    },

    async importMember({ name, phone, plates, reason, validUntil, reviewDate, dependents, dryRun }) {
      const { data, error } = await client.rpc('import_member', {
        p_name: name,
        p_phone: phone,
        p_plates: plates,
        p_reason: reason,
        p_valid_until: validUntil,
        p_review_date: reviewDate,
        p_dependents: dependents,
        p_dry_run: dryRun,
      })
      if (error) throw new Error(`import_member failed: ${error.message}`)
      return data as {
        status: 'imported' | 'updated' | 'phone_name_conflict'
        existing_name?: string
        vehicles_added?: number
        dependents_added?: number
        plate_conflicts?: string[]
      }
    },

    async getUserDisplayName(userId) {
      const { data, error } = await client
        .from('users')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw new Error(`getUserDisplayName failed: ${error.message}`)
      return (data as { display_name: string } | null)?.display_name ?? null
    },

    async getBindingApprovalPreview(pendingId) {
      const { data: p, error: pe } = await client
        .from('pending_binding')
        .select('status, claim_source, line_user_id, submitted_code, claimed_phone, claimed_name, superseded_count, last_submitted_at')
        .eq('id', pendingId)
        .maybeSingle()
      if (pe) throw new Error(`getBindingApprovalPreview failed: ${pe.message}`)
      if (!p) return null
      const pending = p as {
        status: string
        claim_source: string
        line_user_id: string
        submitted_code: string | null
        claimed_phone: string | null
        claimed_name: string | null
        superseded_count: number
        last_submitted_at: string
      }

      // Resolve WHO would be bound, for the operator to confirm. keyword: via the issued code
      // (no FK between submitted_code and binding_codes). liff: via the canonical phone
      // (users_phone_key guarantees at most one member).
      let matchedUserId: string | null = null
      if (pending.claim_source === 'liff') {
        const { data: u, error: ue } = await client
          .from('users')
          .select('id')
          .eq('phone_number', pending.claimed_phone)
          .maybeSingle()
        if (ue) throw new Error(`getBindingApprovalPreview phone lookup failed: ${ue.message}`)
        matchedUserId = (u as { id: string } | null)?.id ?? null
      } else {
        const { data: c, error: ce } = await client
          .from('binding_codes')
          .select('user_id')
          .eq('code', pending.submitted_code)
          .maybeSingle()
        if (ce) throw new Error(`getBindingApprovalPreview code lookup failed: ${ce.message}`)
        matchedUserId = (c as { user_id: string } | null)?.user_id ?? null
      }

      let matchedDisplayName: string | null = null
      if (matchedUserId) {
        const { data: u, error: ue } = await client
          .from('users')
          .select('display_name')
          .eq('id', matchedUserId)
          .maybeSingle()
        if (ue) throw new Error(`getBindingApprovalPreview user lookup failed: ${ue.message}`)
        matchedDisplayName = (u as { display_name: string } | null)?.display_name ?? null
      }

      return {
        pending_status: pending.status,
        claim_source: pending.claim_source,
        line_user_id: pending.line_user_id,
        submitted_code: pending.submitted_code,
        claimed_phone: pending.claimed_phone,
        claimed_name: pending.claimed_name,
        superseded_count: pending.superseded_count,
        last_submitted_at: pending.last_submitted_at,
        matched_user_id: matchedUserId,
        matched_display_name: matchedDisplayName,
      }
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

    async getUserByLineId(lineUserId) {
      const { data, error } = await client
        .from('users')
        .select('id, display_name')
        .eq('line_id', lineUserId)
        .maybeSingle()
      if (error) throw new Error(`getUserByLineId failed: ${error.message}`)
      return (data as { id: string; display_name: string } | null) ?? null
    },

    async createMemberSession(args) {
      const { error } = await client.from('member_sessions').insert({
        user_id: args.userId,
        token_hash: args.tokenHash,
        expires_at: args.expiresAt,
      })
      if (error) throw new Error(`createMemberSession failed: ${error.message}`)
    },

    async getMemberSessionByTokenHash(tokenHash) {
      const { data, error } = await client
        .from('member_sessions')
        .select('id, user_id, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throw new Error(`getMemberSessionByTokenHash failed: ${error.message}`)
      if (!data) return null
      return {
        id: data.id as string,
        user_id: data.user_id as string,
        expires_at: new Date(data.expires_at as string),
      }
    },

    async deleteMemberSessionByTokenHash(tokenHash) {
      const { error } = await client.from('member_sessions').delete().eq('token_hash', tokenHash)
      if (error) throw new Error(`deleteMemberSessionByTokenHash failed: ${error.message}`)
    },

    async deleteExpiredMemberSessions(userId, nowIso) {
      const { error } = await client
        .from('member_sessions')
        .delete()
        .eq('user_id', userId)
        .lt('expires_at', nowIso)
      if (error) throw new Error(`deleteExpiredMemberSessions failed: ${error.message}`)
    },

    async getAdminAccountByUsername(username) {
      const { data, error } = await client
        .from('admin_accounts')
        .select('id, username, password_hash, failed_attempts, locked_at, disabled_at')
        .eq('username', username)
        .maybeSingle()
      if (error) throw new Error(`getAdminAccountByUsername failed: ${error.message}`)
      if (!data) return null
      return {
        id: data.id as string,
        username: data.username as string,
        password_hash: data.password_hash as string,
        failed_attempts: data.failed_attempts as number,
        locked_at: parseDate(data.locked_at as string | null),
        disabled_at: parseDate(data.disabled_at as string | null),
      }
    },

    async insertAdminAccount({ username, passwordHash, displayName = null }) {
      const { error } = await client.from('admin_accounts').insert({
        username,
        password_hash: passwordHash,
        display_name: displayName,
      })
      if (error) {
        if (error.code === '23505') return { inserted: false } // duplicate username → caller reports
        throw new Error(`insertAdminAccount failed: ${error.message}`)
      }
      return { inserted: true }
    },

    async resetAdminLoginFailures(id) {
      const { error } = await client
        .from('admin_accounts')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', id)
      if (error) throw new Error(`resetAdminLoginFailures failed: ${error.message}`)
    },

    async applyAdminLoginFailure({ id, nowIso, threshold, lockMinutes }) {
      const { data, error } = await client.rpc('apply_admin_login_failure', {
        p_id: id,
        p_now: nowIso,
        p_threshold: threshold,
        p_lock_minutes: lockMinutes,
      })
      if (error) throw new Error(`apply_admin_login_failure failed: ${error.message}`)
      const row = data as { failed_attempts: number; locked_at: string | null } | null
      return {
        failed_attempts: row?.failed_attempts ?? 0,
        locked_at: parseDate(row?.locked_at ?? null),
      }
    },

    async createAdminSession(args) {
      const { error } = await client.from('admin_sessions').insert({
        admin_id: args.adminId,
        token_hash: args.tokenHash,
        expires_at: args.expiresAt,
      })
      if (error) throw new Error(`createAdminSession failed: ${error.message}`)
    },

    async getAdminSessionByTokenHash(tokenHash) {
      // Join the account so a disabled admin's live sessions die on their next request.
      const { data, error } = await client
        .from('admin_sessions')
        .select('id, admin_id, expires_at, admin_accounts!inner(username, disabled_at)')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throw new Error(`getAdminSessionByTokenHash failed: ${error.message}`)
      if (!data) return null
      const account = data.admin_accounts as unknown as { username: string; disabled_at: string | null }
      return {
        id: data.id as string,
        admin_id: data.admin_id as string,
        expires_at: new Date(data.expires_at as string),
        username: account.username,
        account_disabled_at: parseDate(account.disabled_at),
      }
    },

    async deleteAdminSessionByTokenHash(tokenHash) {
      const { error } = await client.from('admin_sessions').delete().eq('token_hash', tokenHash)
      if (error) throw new Error(`deleteAdminSessionByTokenHash failed: ${error.message}`)
    },

    async deleteExpiredAdminSessions(adminId, nowIso) {
      const { error } = await client
        .from('admin_sessions')
        .delete()
        .eq('admin_id', adminId)
        .lt('expires_at', nowIso)
      if (error) throw new Error(`deleteExpiredAdminSessions failed: ${error.message}`)
    },

    async getAdminAccountById(id) {
      const { data, error } = await client
        .from('admin_accounts')
        .select('id, username, password_hash, failed_attempts, locked_at, disabled_at')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`getAdminAccountById failed: ${error.message}`)
      if (!data) return null
      return {
        id: data.id as string,
        username: data.username as string,
        password_hash: data.password_hash as string,
        failed_attempts: data.failed_attempts as number,
        locked_at: parseDate(data.locked_at as string | null),
        disabled_at: parseDate(data.disabled_at as string | null),
      }
    },

    async listAdminAccounts() {
      const { data, error } = await client
        .from('admin_accounts')
        .select('id, username, display_name, locked_at, disabled_at, created_at')
        .order('username', { ascending: true })
      if (error) throw new Error(`listAdminAccounts failed: ${error.message}`)
      return (data ?? []).map(row => ({
        id: row.id as string,
        username: row.username as string,
        display_name: row.display_name as string | null,
        locked_at: parseDate(row.locked_at as string | null),
        disabled_at: parseDate(row.disabled_at as string | null),
        created_at: new Date(row.created_at as string),
      }))
    },

    async setAdminDisabled({ targetId, actingAdminId, disabled, nowIso }) {
      const { data, error } = await client.rpc('set_admin_disabled', {
        p_target_id: targetId,
        p_acting_admin_id: actingAdminId,
        p_disabled: disabled,
        p_now: nowIso,
      })
      if (error) throw new Error(`set_admin_disabled failed: ${error.message}`)
      return data as { ok: boolean; reason?: string }
    },

    async resetAdminPassword({ targetId, actingAdminId, passwordHash }) {
      const { data, error } = await client.rpc('reset_admin_password', {
        p_target_id: targetId,
        p_acting_admin_id: actingAdminId,
        p_password_hash: passwordHash,
      })
      if (error) throw new Error(`reset_admin_password failed: ${error.message}`)
      return data as { ok: boolean; reason?: string; username?: string; disabled?: boolean }
    },

    async deleteAdminSessionsByAdminId(id) {
      const { error, count } = await client
        .from('admin_sessions')
        .delete({ count: 'exact' })
        .eq('admin_id', id)
      if (error) throw new Error(`deleteAdminSessionsByAdminId failed: ${error.message}`)
      return { deleted: count ?? 0 }
    },

    async getMemberEvent(todayTaipei) {
      const { data, error } = await client
        .from('weekly_events')
        .select('id, sunday_date, status')
        .gte('sunday_date', todayTaipei)
        .order('sunday_date', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`getMemberEvent failed: ${error.message}`)
      return (data as WeeklyEventRow | null) ?? null
    },

    async getMemberWeekReservation(userId, eventId) {
      const { data, error } = await client
        .from('reservations')
        .select(
          'id, status, effective_priority, applied_at, attended_at, release_deadline_at, offer_expires_at, p2_on_the_way, vehicles(license_plate)',
        )
        .eq('weekly_event_id', eventId)
        .eq('user_id', userId)
      if (error) throw new Error(`getMemberWeekReservation failed: ${error.message}`)
      const rows = (data ?? []) as Array<Record<string, unknown>>
      if (rows.length === 0) return null

      // The one-active-per-member index allows cancelled siblings next to one live
      // row: show the live row if present, else the most recent cancellation.
      const isCancelled = (r: Record<string, unknown>) =>
        r.status === 'cancelled_by_user' || r.status === 'cancelled_late'
      rows.sort((a, b) => {
        if (isCancelled(a) !== isCancelled(b)) return isCancelled(a) ? 1 : -1
        return String(b.applied_at).localeCompare(String(a.applied_at))
      })
      const row = rows[0]
      const vehicle = row.vehicles as { license_plate?: string } | null
      return {
        id: row.id as string,
        status: row.status as ReservationStatus,
        effective_priority: row.effective_priority as number,
        license_plate: vehicle?.license_plate ?? null,
        applied_at: new Date(row.applied_at as string),
        attended_at: parseDate(row.attended_at as string | null),
        release_deadline_at: parseDate(row.release_deadline_at as string | null),
        offer_expires_at: parseDate(row.offer_expires_at as string | null),
        p2_on_the_way: (row.p2_on_the_way as boolean | null) ?? false,
      }
    },

    async getMemberVehicles(userId) {
      const { data, error } = await client
        .from('vehicles')
        .select('id, license_plate, nickname')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
      if (error) throw new Error(`getMemberVehicles failed: ${error.message}`)
      return (data ?? []) as MemberVehicleRow[]
    },

    async getMemberEligibility(userId) {
      const { data, error } = await client
        .from('user_eligibility')
        .select('p2_eligible, p2_reason, p2_valid_until')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error(`getMemberEligibility failed: ${error.message}`)
      return (data as { p2_eligible: boolean; p2_reason: string | null; p2_valid_until: string | null } | null) ?? null
    },

    async getUserRole(userId) {
      const { data, error } = await client
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw new Error(`getUserRole failed: ${error.message}`)
      return ((data as { role: string } | null)?.role ?? null)
    },

    async searchMembers({ nameQuery, phoneQuery, plateQuery, candidateCap }) {
      // Collect candidate user ids from each non-null branch (each independently capped
      // so no single branch can pull the whole table). `.ilike()` parameterizes the
      // value against filter-syntax injection; the service already stripped %/_ wildcards.
      const ids = new Set<string>()

      const collectUsers = async (column: 'display_name' | 'phone_number', q: string) => {
        const { data, error } = await client
          .from('users')
          .select('id')
          .ilike(column, `%${q}%`)
          .limit(candidateCap)
        if (error) throw new Error(`searchMembers (${column}) failed: ${error.message}`)
        for (const r of data ?? []) ids.add((r as { id: string }).id)
      }

      if (nameQuery !== null) await collectUsers('display_name', nameQuery)
      if (phoneQuery !== null) await collectUsers('phone_number', phoneQuery)
      if (plateQuery !== null) {
        const { data, error } = await client
          .from('vehicles')
          .select('user_id')
          .eq('is_active', true)
          .ilike('license_plate_normalized', `%${plateQuery}%`)
          .limit(candidateCap)
        if (error) throw new Error(`searchMembers (plate) failed: ${error.message}`)
        for (const r of data ?? []) ids.add((r as { user_id: string }).user_id)
      }

      if (ids.size === 0) return []
      const idList = [...ids]

      const { data: users, error: ue } = await client
        .from('users')
        .select('id, display_name, phone_number, role, line_id')
        .in('id', idList)
      if (ue) throw new Error(`searchMembers users fetch failed: ${ue.message}`)

      const { data: plateRows, error: pe } = await client
        .from('vehicles')
        .select('user_id, license_plate')
        .eq('is_active', true)
        .in('user_id', idList)
        .order('created_at', { ascending: true })
      if (pe) throw new Error(`searchMembers plates fetch failed: ${pe.message}`)

      const platesByUser = new Map<string, string[]>()
      for (const r of (plateRows ?? []) as Array<{ user_id: string; license_plate: string }>) {
        const arr = platesByUser.get(r.user_id) ?? []
        arr.push(r.license_plate)
        platesByUser.set(r.user_id, arr)
      }

      const rows = ((users ?? []) as Array<{
        id: string; display_name: string; phone_number: string | null; role: string; line_id: string | null
      }>).map(u => ({
        id: u.id,
        display_name: u.display_name,
        phone_number: u.phone_number,
        role: u.role,
        line_id: u.line_id,
        plates: platesByUser.get(u.id) ?? [],
      }))

      // Stable order so hasMore (service slices limit+1) and pagination hints are deterministic.
      rows.sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-Hant') || a.id.localeCompare(b.id))
      return rows
    },

    async getMemberAdminDetail(userId) {
      const { data: user, error: ue } = await client
        .from('users')
        .select('display_name, phone_number, role, line_id')
        .eq('id', userId)
        .maybeSingle()
      if (ue) throw new Error(`getMemberAdminDetail user failed: ${ue.message}`)
      if (!user) return null
      const u = user as { display_name: string; phone_number: string | null; role: string; line_id: string | null }

      const { data: vehicles, error: ve } = await client
        .from('vehicles')
        .select('license_plate, nickname')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
      if (ve) throw new Error(`getMemberAdminDetail vehicles failed: ${ve.message}`)

      const { data: elig, error: ee } = await client
        .from('user_eligibility')
        .select('p2_eligible, p2_reason, p2_valid_until, p2_review_date, reviewed_at')
        .eq('user_id', userId)
        .maybeSingle()
      if (ee) throw new Error(`getMemberAdminDetail eligibility failed: ${ee.message}`)

      const { data: deps, error: de } = await client
        .from('eligibility_dependents')
        .select('dependent_kind, dependent_name, dependent_birthdate')
        .eq('user_id', userId)
        .order('dependent_birthdate', { ascending: true, nullsFirst: true })
      if (de) throw new Error(`getMemberAdminDetail dependents failed: ${de.message}`)

      return {
        display_name: u.display_name,
        phone_number: u.phone_number,
        role: u.role,
        line_id: u.line_id,
        vehicles: ((vehicles ?? []) as Array<{ license_plate: string; nickname: string | null }>).map(v => ({
          license_plate: v.license_plate,
          nickname: v.nickname,
        })),
        eligibility: elig
          ? (elig as {
              p2_eligible: boolean; p2_reason: string | null; p2_valid_until: string | null
              p2_review_date: string | null; reviewed_at: string | null
            })
          : null,
        dependents: ((deps ?? []) as Array<{ dependent_kind: string; dependent_name: string; dependent_birthdate: string | null }>).map(d => ({
          kind: d.dependent_kind,
          name: d.dependent_name,
          birthdate: d.dependent_birthdate,
        })),
      }
    },

    async hasFridayAllocationRun(eventId) {
      const { data, error } = await client
        .from('job_runs')
        .select('status')
        .eq('weekly_event_id', eventId)
        .eq('job_type', 'friday_allocation')
        .in('status', ['running', 'success'])
        .limit(1)
      if (error) throw new Error(`hasFridayAllocationRun failed: ${error.message}`)
      return (data ?? []).length > 0
    },

    async claimFridayAllocation(eventId, jobType) {
      const { data, error } = await client.rpc('claim_friday_allocation', {
        p_event_id: eventId,
        p_job_type: jobType,
      })
      if (error) throw new Error(`claim_friday_allocation failed: ${error.message}`)
      const row = data as { claimed: boolean; reason: string }
      return { claimed: row.claimed, reason: row.reason }
    },

    async applyReservation({ eventId, userId, vehicleId, requestedP2, effectivePriority, nowIso }) {
      const { data, error } = await client.rpc('apply_reservation', {
        p_event_id: eventId,
        p_user_id: userId,
        p_vehicle_id: vehicleId,
        p_requested_p2: requestedP2,
        p_effective_priority: effectivePriority,
        p_now: nowIso,
      })
      if (error) throw new Error(`apply_reservation failed: ${error.message}`)
      const row = data as { applied: number; reason: string }
      return { applied: row.applied, reason: row.reason }
    },
  }
}
