import type { WeekStage } from '@/lib/weekStage'

// Client-safe admin overview / todo DTOs (Wave 3 / #8 + #9). No I/O, no server
// imports — AdminSidebar and AdminTodoProvider are client components that consume
// these, and importing server/services/* would bundle the service-role Supabase
// client into the client (see lib/capacityAdminTypes.ts for the same reasoning).

export interface AdminTodoCounts {
  // Members whose P2 eligibility is due for a human review as of today
  // (= listEligibilityReview.counts.expired + review_due — the authoritative
  // classifier, not a re-hand-coded date boundary).
  p2Review: number
  // Open pastoral-care alerts (v1: a single count; open/overdue split is deferred).
  pastoralOpen: number
  // Notification-pipeline health — ops domain, so null for a clerk (no view_ops).
  ops: {
    healthy: boolean   // buildOutboxAlertFromHealth(...).healthy — the ops-page verdict
    backlog: number    // rows due to send now (informational "通知待送 N")
    attention: number  // drives the badge; 0 when healthy, else failed+stale+staleBacklog
  } | null
}

// The todo counts are AUXILIARY: a query failure must never take down the whole
// admin shell (the layout that fetches this wraps every /admin page). So the snapshot
// carries counts OR an explicit null — null means "couldn't fetch", NOT "all zero".
export interface AdminTodoSnapshot {
  counts: AdminTodoCounts | null
  snapshotAt: string  // ISO; shown on the overview + used by its "重新整理" affordance
}

export interface WeekOverview {
  sunday: string       // YYYY-MM-DD (Taipei calendar, upcomingSundayISO)
  stage: WeekStage
  capacity: {
    allocatable: number  // computeCapacity(...) TOTAL — the formula result, not "spaces left"
    blocked: number      // 保留·停用 (blocked_spaces, the single post-0031 number)
    promised: number     // approved + temp_approved
  } | null               // null = no weekly_events row yet (stage 'no_event')
}
