import type { AllocationUser, EffectivePriority, Reservation } from '@/lib/types'

export function computeEffectivePriority(
  user: Pick<AllocationUser, 'p1_eligible' | 'p2_eligible'>,
  reservation: Pick<Reservation, 'requested_p2_this_week'>,
): EffectivePriority {
  if (user.p1_eligible) return 1
  if (user.p2_eligible && reservation.requested_p2_this_week) return 2
  return 3
}

// ── Member apply-time priority (Phase 7 Slice 3, development_plan §4) ─────────
// effective_priority is frozen onto the reservation row at APPLY time. Auto reasons
// (long/short mobility, pregnancy) grant P2 every week without a declaration;
// companion reasons (elderly/child) grant P2 only when the member declares the
// companion for THIS week. An expired eligibility (p2_valid_until before the
// event's Sunday) falls back to P3. P1 never applies through this flow —
// full-time staff spots live in weekly_staff_allocations.
const AUTO_P2_REASONS = new Set(['mobility_long', 'mobility_short', 'pregnancy'])
const DECLARED_P2_REASONS = new Set(['elderly_companion', 'child_companion'])

export interface ApplyEligibility {
  p2_eligible: boolean
  p2_reason: string | null
  p2_valid_until: string | null   // 'YYYY-MM-DD'
}

function eligibilityActive(e: ApplyEligibility | null, sundayDate: string): boolean {
  if (!e || !e.p2_eligible || !e.p2_reason) return false
  if (e.p2_valid_until !== null && e.p2_valid_until < sundayDate) return false
  return true
}

export function computeApplyPriority(
  eligibility: ApplyEligibility | null,
  requestedP2ThisWeek: boolean,
  sundayDate: string,
): 2 | 3 {
  if (!eligibilityActive(eligibility, sundayDate)) return 3
  const reason = eligibility!.p2_reason!
  if (AUTO_P2_REASONS.has(reason)) return 2
  if (DECLARED_P2_REASONS.has(reason) && requestedP2ThisWeek) return 2
  return 3
}

// UI hint: whether the apply form should offer the weekly companion declaration.
export function canDeclareCompanion(
  eligibility: ApplyEligibility | null,
  sundayDate: string,
): 'elderly' | 'child' | null {
  if (!eligibilityActive(eligibility, sundayDate)) return null
  if (eligibility!.p2_reason === 'elderly_companion') return 'elderly'
  if (eligibility!.p2_reason === 'child_companion') return 'child'
  return null
}
