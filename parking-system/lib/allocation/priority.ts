import type { AllocationUser, EffectivePriority, Reservation } from '@/lib/types'

export function computeEffectivePriority(
  user: Pick<AllocationUser, 'p1_eligible' | 'p2_eligible'>,
  reservation: Pick<Reservation, 'requested_p2_this_week'>,
): EffectivePriority {
  if (user.p1_eligible) return 1
  if (user.p2_eligible && reservation.requested_p2_this_week) return 2
  return 3
}
