import { describe, expect, it } from 'vitest'
import { buildAdminTodoRows } from '@/lib/adminTodoRows'
import type { AdminTodoCounts } from '@/lib/adminTodoTypes'

const counts = (over: Partial<AdminTodoCounts> = {}): AdminTodoCounts => ({
  p2Review: 0,
  pastoralOpen: 0,
  ops: null,
  ...over,
})

describe('buildAdminTodoRows', () => {
  it('P2 + pastoral rows when > 0', () => {
    const rows = buildAdminTodoRows(counts({ p2Review: 1, pastoralOpen: 2 }))
    expect(rows).toEqual([
      { href: '/admin/eligibility', label: '資格待審', count: 1, tone: 'warning' },
      { href: '/admin/pastoral', label: '牧養關懷待跟進', count: 2, tone: 'warning' },
    ])
  })

  it('healthy backlog (attention 0, backlog 4) → 通知待送 4 row — NOT empty, so no 🎉', () => {
    const rows = buildAdminTodoRows(counts({ ops: { backlog: 4, attention: 0 } }))
    expect(rows).toEqual([{ href: '/admin/ops', label: '通知待送', count: 4, tone: 'info' }])
  })

  it('unhealthy (attention 4) → 通知系統異常 4 (danger); backlog is not also shown', () => {
    const rows = buildAdminTodoRows(counts({ ops: { backlog: 4, attention: 4 } }))
    expect(rows).toEqual([{ href: '/admin/ops', label: '通知系統異常', count: 4, tone: 'danger' }])
  })

  it('all clear (everything 0, backlog 0) → no rows → the overview shows 🎉', () => {
    expect(buildAdminTodoRows(counts({ ops: { backlog: 0, attention: 0 } }))).toEqual([])
    expect(buildAdminTodoRows(counts())).toEqual([]) // clerk: ops null, nothing pending
  })

  it('clerk (ops null) → no ops row even if member-facing work exists', () => {
    const rows = buildAdminTodoRows(counts({ p2Review: 3, ops: null }))
    expect(rows).toEqual([{ href: '/admin/eligibility', label: '資格待審', count: 3, tone: 'warning' }])
  })
})
