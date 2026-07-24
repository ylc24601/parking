import { cache } from 'react'
import { can, type AdminRole } from '@/lib/adminRoles'
import type { AdminTodoCounts, AdminTodoSnapshot } from '@/lib/adminTodoTypes'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import { listEligibilityReview } from '@/server/services/eligibilityReviewService'
import { getOutboxHealth } from '@/server/services/outboxHealthService'
import { buildOutboxAlertFromHealth, readAlertThresholds } from '@/server/services/outboxAlertService'

// ── Admin overview / sidebar todo counts (Wave 3 / #8 + #9) ──────────────────
// One snapshot drives both the /admin dashboard "下待辦" list and the sidebar
// badges. business semantics live HERE, not in the client (triage: "不硬 RPC").

// Per-request clock, memoized so the layout and the /admin page agree on "now"
// (and therefore on today / this Sunday / the alert age / the snapshot time).
// React cache() is scoped to a single Server Component render request and cleared
// after it — this is the same "one snapshot + one now" discipline the ops page uses.
export const getAdminRequestNow = cache((): Date => new Date())

// The P2 badge reuses the AUTHORITATIVE classifier (deriveEligibilityStatus, via
// listEligibilityReview) rather than re-encoding the expired/review_due/not_yet_effective
// precedence in a PostgREST filter — that would be a second source of truth that could
// drift from the eligibility page. `expired + review_due` = "needs a human today"
// (upcoming/not_yet_effective are deliberately excluded).
export async function computeAdminTodoCounts(
  params: { now: Date; role: AdminRole },
  repo: ParkingRepository = createParkingRepository(),
): Promise<AdminTodoCounts> {
  const { now, role } = params

  const p2Promise = listEligibilityReview(repo, now).then(r => r.counts.expired + r.counts.review_due)
  const pastoralPromise = repo.countOpenPastoralAlerts()

  // Clerk: no ops visibility. Don't even fetch outbox health.
  if (!can(role, 'view_ops')) {
    const [p2Review, pastoralOpen] = await Promise.all([p2Promise, pastoralPromise])
    return { p2Review, pastoralOpen, ops: null }
  }

  // getOutboxHealth MUST receive the same repo — a default would build a real
  // service-role client and break unit tests that inject a mock.
  const [p2Review, pastoralOpen, health] = await Promise.all([
    p2Promise,
    pastoralPromise,
    getOutboxHealth({ now }, repo),
  ])

  const alert = buildOutboxAlertFromHealth(health, readAlertThresholds(), now)
  // A due backlog that has aged past the threshold is itself a breach even with
  // failed=0 / stale=0 — so fold it into attention. Gate the whole sum by `healthy`
  // so the badge lights EXACTLY when the ops page shows 異常 (raising a threshold
  // could otherwise leave failed>0 while healthy stays true, and the two would disagree).
  const staleBacklog = alert.breaches.includes('due_backlog_stale') ? health.due : 0
  const attention = alert.healthy ? 0 : health.failed + health.stale_processing + staleBacklog

  return {
    p2Review,
    pastoralOpen,
    ops: { healthy: alert.healthy, backlog: health.due, attention },
  }
}

// Fail-soft wrapper for the admin shell. The layout renders on EVERY /admin page, so
// a thrown count query must not 500 the whole back-office — badges are auxiliary.
// On failure: log a fixed, PII-free code (no error object, no request data) and return
// counts:null. A null snapshot means "couldn't fetch", never "all zero" — the sidebar
// shows no badges and the overview says so explicitly instead of a false 🎉.
export async function getAdminTodoSnapshot(
  role: AdminRole,
  repo: ParkingRepository = createParkingRepository(),
  // Defaults to the shared per-request clock (only evaluated when omitted, i.e. in the
  // RSC render); tests pass a fixed Date so they never touch React cache().
  now: Date = getAdminRequestNow(),
): Promise<AdminTodoSnapshot> {
  try {
    const counts = await computeAdminTodoCounts({ now, role }, repo)
    return { counts, snapshotAt: now.toISOString() }
  } catch {
    console.error('admin_todo_snapshot_failed')
    return { counts: null, snapshotAt: now.toISOString() }
  }
}
