'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { WeekOverview } from '@/lib/adminTodoTypes'
import { buildAdminTodoRows } from '@/lib/adminTodoRows'
import { fmtTaipeiTime } from '@/lib/taipeiDate'
import { WEEK_STAGE_LABEL, type WeekStage } from '@/lib/weekStage'
import Badge, { type BadgeTone } from '../ui/Badge'
import { useAdminTodos } from './AdminTodoProvider'

// Back-office overview (Wave 3 / #8). The landing dashboard: 上指標 (this week's stage
// + capacity, live from the server) over 下待辦 (attention items, from the shared todo
// snapshot). The todo numbers come from useAdminTodos() — the SAME snapshot the sidebar
// badges read — so the two can never disagree.

const STAGE_TONE: Record<WeekStage, BadgeTone> = {
  no_event: 'warning',
  application_open: 'success',
  allocated: 'info',
  finalized: 'neutral',
  closed: 'neutral',
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-ink">{value}</span>
    </div>
  )
}

// A count-less row (a clerk's notification verdict, #17 C) carries its severity in the
// container colour instead of a badge — otherwise a danger row would look like plain text.
const NOTICE_TONE: Record<BadgeTone, string> = {
  danger: 'border-danger-fg/30 bg-danger-bg text-danger-fg',
  warning: 'border-warning-fg/30 bg-warning-bg text-warning-fg',
  info: 'border-border bg-page text-muted',
  success: 'border-success-fg/30 bg-success-bg text-success-fg',
  priority: 'border-priority-fg/30 bg-priority-bg text-priority-fg',
  neutral: 'border-border bg-page text-muted',
}

// A todo row. With an href it links to the page that clears it and shows a count badge;
// without one it is a non-interactive notice tinted by tone (#17 C: clerk health verdict).
function TodoRow({ href, label, count, tone }: { href?: string; label: string; count?: number; tone: BadgeTone }) {
  if (href) {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-page px-4 py-3 text-sm transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <span className="font-medium text-ink">{label}</span>
        {count !== undefined && <Badge tone={tone}>{count}</Badge>}
      </Link>
    )
  }
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${NOTICE_TONE[tone]}`}>
      <span>{label}</span>
      {count !== undefined && <Badge tone={tone}>{count}</Badge>}
    </div>
  )
}

export default function AdminOverview({ overview }: { overview: WeekOverview }) {
  const router = useRouter()
  const { counts, snapshotAt } = useAdminTodos()

  // Rows come from the shared pure builder, so 🎉 shows iff it returns [] — meaning
  // "nothing THIS ROLE needs to handle" (#17 C). A superadmin's healthy-but-draining
  // backlog still produces its own "通知待送" row, so their 🎉 is genuine; a clerk's plain
  // verdict has no backlog to surface, so a draining queue correctly shows no row.
  const todos = counts ? buildAdminTodoRows(counts) : []

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 bg-page px-6 py-8 text-ink">
      <h1 className="text-2xl font-bold tracking-tight">本週概覽</h1>

      {/* 上指標 — this week's stage + capacity (live) */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">本週主日</span>
          <span className="font-semibold tabular-nums text-ink">{overview.sunday}</span>
          <Badge tone={STAGE_TONE[overview.stage]}>{WEEK_STAGE_LABEL[overview.stage]}</Badge>
        </div>
        {overview.capacity ? (
          <div className="flex flex-wrap gap-8 pt-1">
            <Stat label="可分配總數" value={overview.capacity.allocatable} />
            <Stat label="保留·停用" value={overview.capacity.blocked} />
            <Stat label="已核准" value={overview.capacity.promised} />
          </div>
        ) : (
          <p className="text-sm text-muted">尚未建立本週場次，車位資料待排定後顯示。</p>
        )}
      </section>

      {/* 下待辦 — attention items from the shared snapshot */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">待辦事項</h2>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>資料時間 {fmtTaipeiTime(snapshotAt)}</span>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="rounded-lg border border-border px-3 py-1.5 font-medium text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              重新整理
            </button>
          </div>
        </div>

        {counts === null ? (
          <p className="rounded-lg border border-border bg-page px-4 py-3 text-sm text-muted">
            待辦資料暫時無法取得，請點「重新整理」再試。
          </p>
        ) : todos.length === 0 ? (
          <p className="rounded-lg border border-border bg-page px-4 py-6 text-center text-sm text-muted">
            目前沒有需要處理的事項 🎉
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {todos.map(t => (
              <TodoRow key={t.id} href={t.href} label={t.label} count={t.count} tone={t.tone} />
            ))}
          </div>
        )}

        <p className="text-xs text-muted">
          待辦數字為最近一次載入／重新整理的快照，處理後會自動更新；跨裝置或系統背景的變動請重新整理。
        </p>
      </section>
    </main>
  )
}
