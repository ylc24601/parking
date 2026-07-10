import { describe, expect, it } from 'vitest'
import { canDeclareCompanion, computeApplyPriority, type ApplyEligibility } from '@/lib/allocation/priority'

// development_plan §4 — apply-time effective_priority. Auto reasons grant P2 without
// a weekly declaration; companion reasons need requested_p2_this_week; expired
// eligibility (p2_valid_until before the Sunday) falls back to P3.
const SUNDAY = '2026-07-12'

const elig = (reason: string, validUntil: string | null = null): ApplyEligibility => ({
  p2_eligible: true,
  p2_reason: reason,
  p2_valid_until: validUntil,
})

describe('computeApplyPriority', () => {
  it.each(['mobility_long', 'mobility_short', 'pregnancy'])(
    'auto reason %s → P2 without a declaration',
    reason => {
      expect(computeApplyPriority(elig(reason), false, SUNDAY)).toBe(2)
      expect(computeApplyPriority(elig(reason), true, SUNDAY)).toBe(2)
    },
  )

  it.each(['elderly_companion', 'child_companion'])(
    'companion reason %s → P2 only when declared this week',
    reason => {
      expect(computeApplyPriority(elig(reason), true, SUNDAY)).toBe(2)
      expect(computeApplyPriority(elig(reason), false, SUNDAY)).toBe(3)
    },
  )

  it('expired p2_valid_until → P3 even for auto reasons', () => {
    expect(computeApplyPriority(elig('pregnancy', '2026-07-11'), false, SUNDAY)).toBe(3)
    expect(computeApplyPriority(elig('child_companion', '2026-07-01'), true, SUNDAY)).toBe(3)
  })

  it('valid-until ON the Sunday still counts', () => {
    expect(computeApplyPriority(elig('pregnancy', SUNDAY), false, SUNDAY)).toBe(2)
  })

  it('no eligibility row / not eligible / unknown reason → P3', () => {
    expect(computeApplyPriority(null, true, SUNDAY)).toBe(3)
    expect(computeApplyPriority({ p2_eligible: false, p2_reason: null, p2_valid_until: null }, true, SUNDAY)).toBe(3)
    expect(computeApplyPriority(elig('something_else'), true, SUNDAY)).toBe(3)
  })
})

describe('canDeclareCompanion', () => {
  it('maps companion reasons to the UI hint; auto reasons and P3 get none', () => {
    expect(canDeclareCompanion(elig('elderly_companion'), SUNDAY)).toBe('elderly')
    expect(canDeclareCompanion(elig('child_companion'), SUNDAY)).toBe('child')
    expect(canDeclareCompanion(elig('mobility_long'), SUNDAY)).toBeNull()
    expect(canDeclareCompanion(null, SUNDAY)).toBeNull()
  })

  it('expired companion eligibility gets no declaration checkbox', () => {
    expect(canDeclareCompanion(elig('child_companion', '2026-07-01'), SUNDAY)).toBeNull()
  })
})
