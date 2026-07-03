import { vi } from 'vitest'
import type { ParkingRepository } from '@/server/repositories/parkingRepository'

// A ParkingRepository of vi.fn() spies with sensible defaults; override per test.
export type MockRepo = { [K in keyof ParkingRepository]: ReturnType<typeof vi.fn> }

export function makeMockRepo(overrides: Partial<MockRepo> = {}): MockRepo {
  const repo: MockRepo = {
    getWeeklyEvent: vi.fn(async () => ({ id: 'event-1', sunday_date: '2026-06-21', status: 'open' })),
    getActiveEvent: vi.fn(async () => ({ id: 'event-1', sunday_date: '2026-06-21', status: 'open' })),
    getWeeklyEventBySunday: vi.fn(async () => ({ id: 'event-1', sunday_date: '2026-06-21', status: 'open' })),
    finalizeWeeklyEvent: vi.fn(async () => {}),
    getStaleOpenEvents: vi.fn(async () => []),
    getStaffCheckInList: vi.fn(async () => []),
    createWalkInReservation: vi.fn(async () => ({
      row: {
        reservation_id: 'walkin-1',
        weekly_event_id: 'event-1',
        display_name: null,
        license_plate: null,
        walk_in_name: '現場散客',
        walk_in_license_plate: 'WALK-0001',
        is_priority: false,
        status: 'walk_in',
        attended_at: new Date('2026-06-21T02:00:00Z'),
      },
    })),
    getCapacityInputs: vi.fn(),
    getPendingForAllocation: vi.fn(async () => []),
    applyFridayAllocation: vi.fn(async () => ({ skipped: false, updated: 0, outbox_enqueued: 0 })),
    markJobFailed: vi.fn(async () => {}),
    getReservation: vi.fn(async () => null),
    getWaitingForSubstitution: vi.fn(async () => []),
    getExpiredOffers: vi.fn(async () => []),
    getTempApproved: vi.fn(async () => []),
    applyCancellation: vi.fn(async () => ({ cancelled: 1, substitute_applied: 1, outbox_enqueued: 1 })),
    applyOffer: vi.fn(async () => ({ offered: 1, outbox_enqueued: 1 })),
    applyOfferResolution: vi.fn(async () => ({ resolved: 1, next_applied: 1, outbox_enqueued: 1 })),
    // Slice 3
    getReservationsForRelease: vi.fn(async () => []),
    getPenaltyCounters: vi.fn(async () => ({ penalty_score: 0, consecutive_no_show: 0, last_successful_attended_at: null })),
    getP2ArrivalReminderTargets: vi.fn(async () => []),
    applyRelease: vi.fn(async () => ({ released: 0, outbox_enqueued: 0 })),
    applyAttendance: vi.fn(async () => ({ attended: 1, penalty_updated: 1 })),
    setOnTheWay: vi.fn(async () => 1),
    enqueueOutbox: vi.fn(async () => 0),
    // Phase 4 Slice A — notification dispatcher
    claimOutbox: vi.fn(async () => []),
    markOutboxSent: vi.fn(async () => {}),
    markOutboxRetry: vi.fn(async () => {}),
    markOutboxFailed: vi.fn(async () => {}),
    // Phase 4 Slice C — outbox health
    getOutboxHealth: vi.fn(async () => ({
      due: 0, due_by_template: {}, pending: 0, retrying: 0, processing: 0, stale_processing: 0,
      failed: 0, failed_by_error: {}, sent_last_24h: 0,
      oldest_pending_at: null, oldest_failed_at: null, next_retry_at: null,
    })),
    // Phase 4 Slice B — move-car
    getMoveCarTarget: vi.fn(async () => ({
      weekly_event_id: 'event-1',
      user_id: 'u1',
      status: 'attended' as const,
      license_plate: 'ABC-1234',
      notifiable: true,
    })),
    // Slice 4
    getReleasedLateForSettlement: vi.fn(async () => []),
    getPenaltyCountersForUsers: vi.fn(async () => []),
    applySettlement: vi.fn(async () => ({ settled: 0, penalties_applied: 0, alerts_created: 0 })),
    // Phase 3 v2 — Staff PIN session
    getStaffSessionByEvent: vi.fn(async () => null),
    getStaffSessionById: vi.fn(async () => null),
    resetStaffSessionFailures: vi.fn(async () => {}),
    applyStaffPinFailure: vi.fn(async () => ({ failed_attempts: 1, locked_at: null })),
    upsertStaffSessionPin: vi.fn(async () => {}),
    ...overrides,
  }
  return repo
}

// MockRepo is structurally a ParkingRepository; cast at the call site.
export const asRepo = (m: MockRepo): ParkingRepository => m as unknown as ParkingRepository
