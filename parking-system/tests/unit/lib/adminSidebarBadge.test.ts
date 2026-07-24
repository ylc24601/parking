import { describe, expect, it } from 'vitest'
import { badgeForHref } from '@/lib/adminSidebarBadge'
import type { AdminTodoCounts } from '@/lib/adminTodoTypes'

const counts = (over: Partial<AdminTodoCounts> = {}): AdminTodoCounts => ({
  p2Review: 3,
  pastoralOpen: 2,
  ops: { healthy: false, backlog: 5, attention: 4 },
  ...over,
})

describe('badgeForHref', () => {
  it('maps each nav href to its count', () => {
    const c = counts()
    expect(badgeForHref('/admin/eligibility', c)).toBe(3)
    expect(badgeForHref('/admin/pastoral', c)).toBe(2)
    expect(badgeForHref('/admin/ops', c)).toBe(4) // attention, not raw failed+stale
  })

  it('ops uses attention (covers due_backlog_stale, not just failed+stale)', () => {
    expect(badgeForHref('/admin/ops', counts({ ops: { healthy: false, backlog: 7, attention: 7 } }))).toBe(7)
    expect(badgeForHref('/admin/ops', counts({ ops: { healthy: true, backlog: 0, attention: 0 } }))).toBe(0)
  })

  it('clerk (ops null) → ops item has no badge', () => {
    expect(badgeForHref('/admin/ops', counts({ ops: null }))).toBeNull()
  })

  it('unmapped hrefs → null', () => {
    expect(badgeForHref('/admin/members', counts())).toBeNull()
    expect(badgeForHref('/admin/accounts', counts())).toBeNull()
    expect(badgeForHref('/admin', counts())).toBeNull()
  })
})
