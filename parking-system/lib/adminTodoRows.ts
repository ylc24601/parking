import type { AdminTodoCounts } from '@/lib/adminTodoTypes'

// Dashboard "下待辦" rows (Wave 3 / #8). Pure + client-safe so the row/empty-state logic
// is unit-testable (the repo has no page-component harness). The overview shows 🎉 iff
// this returns []; because a healthy-but-draining backlog produces its own "通知待送" row,
// an empty list genuinely means "nothing to see" — a queued backlog never hides behind 🎉.
export type AdminTodoTone = 'warning' | 'danger' | 'info'
export interface AdminTodoRow {
  href: string
  label: string
  count: number
  tone: AdminTodoTone
}

export function buildAdminTodoRows(counts: AdminTodoCounts): AdminTodoRow[] {
  const rows: AdminTodoRow[] = []
  if (counts.p2Review > 0) {
    rows.push({ href: '/admin/eligibility', label: '資格待審', count: counts.p2Review, tone: 'warning' })
  }
  if (counts.pastoralOpen > 0) {
    rows.push({ href: '/admin/pastoral', label: '牧養關懷待跟進', count: counts.pastoralOpen, tone: 'warning' })
  }
  // ops rows only for a superadmin (ops non-null). attention>0 is 異常 (danger); a healthy
  // backlog still draining shows as an informational "通知待送" so it never masquerades as 🎉.
  if (counts.ops) {
    if (counts.ops.attention > 0) {
      rows.push({ href: '/admin/ops', label: '通知系統異常', count: counts.ops.attention, tone: 'danger' })
    } else if (counts.ops.backlog > 0) {
      rows.push({ href: '/admin/ops', label: '通知待送', count: counts.ops.backlog, tone: 'info' })
    }
  }
  return rows
}
