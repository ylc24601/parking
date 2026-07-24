import { describe, expect, it, vi } from 'vitest'
import { makeMockRepo, asRepo, type MockRepo } from './mockRepo'
import { getWeekOverview } from '@/server/services/adminOverviewService'
import { upcomingSundayISO } from '@/lib/taipeiDate'
import type { WeeklyCapacityAdminRow } from '@/server/repositories/parkingRepository'

const NOW = new Date('2026-07-12T00:00:00Z')
const SUNDAY = upcomingSundayISO(NOW)

const capRow = (over: Partial<WeeklyCapacityAdminRow>): WeeklyCapacityAdminRow => ({
  id: 'event-1',
  sunday_date: SUNDAY,
  status: 'open',
  total_capacity: 30,
  blocked_spaces: 5,
  admin_reserved: 0,
  capacity_version: 0,
  active_full_time_staff_reserved: 3,
  ...over,
})

describe('getWeekOverview', () => {
  it('no weekly_events row → stage no_event, capacity null (not an error)', async () => {
    const repo: MockRepo = makeMockRepo({ getWeeklyCapacityAdmin: vi.fn(async () => null) })
    const res = await getWeekOverview({ now: NOW }, asRepo(repo))
    expect(res).toEqual({ sunday: SUNDAY, stage: 'no_event', capacity: null })
    expect(repo.getWeeklyCapacityAdmin).toHaveBeenCalledWith(SUNDAY) // Taipei calendar, not getActiveEvent
  })

  it('open + allocation not run → application_open; capacity = computeCapacity + blocked + promised', async () => {
    const repo: MockRepo = makeMockRepo({
      getWeeklyCapacityAdmin: vi.fn(async () => capRow({ status: 'open' })),
      hasFridayAllocationRun: vi.fn(async () => false),
      countPromisedReservations: vi.fn(async () => 8),
    })
    const res = await getWeekOverview({ now: NOW }, asRepo(repo))
    expect(res.stage).toBe('application_open')
    // 30 - 5 blocked - 0 admin_reserved - 3 staff = 22
    expect(res.capacity).toEqual({ allocatable: 22, blocked: 5, promised: 8 })
  })

  it('open + allocation run → allocated', async () => {
    const repo: MockRepo = makeMockRepo({
      getWeeklyCapacityAdmin: vi.fn(async () => capRow({ status: 'open' })),
      hasFridayAllocationRun: vi.fn(async () => true),
    })
    expect((await getWeekOverview({ now: NOW }, asRepo(repo))).stage).toBe('allocated')
  })

  it('finalized / closed map straight through', async () => {
    for (const status of ['finalized', 'closed'] as const) {
      const repo: MockRepo = makeMockRepo({
        getWeeklyCapacityAdmin: vi.fn(async () => capRow({ status })),
      })
      expect((await getWeekOverview({ now: NOW }, asRepo(repo))).stage).toBe(status)
    }
  })
})
