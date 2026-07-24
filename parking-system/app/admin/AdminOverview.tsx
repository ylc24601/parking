'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { WeekOverview } from '@/lib/adminTodoTypes'
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

function formatSnapshot(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-ink">{value}</span>
    </div>
  )
}

// One actionable todo: label + count, linking to the page that clears it.
function TodoRow({ href, label, count, tone }: { href: string; label: string; count: number; tone: BadgeTone }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-page px-4 py-3 text-sm transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <span className="font-medium text-ink">{label}</span>
      <Badge tone={tone}>{count}</Badge>
    </Link>
  )
}

export default function AdminOverview({ overview }: { overview: WeekOverview }) {
  const router = useRouter()
  const { counts, snapshotAt } = useAdminTodos()

  const todos: Array<{ href: string; label: string; count: number; tone: BadgeTone }> = []
  if (counts) {
    if (counts.p2Review > 0) {
      todos.push({ href: '/admin/eligibility', label: '資格待審', count: counts.p2Review, tone: 'warning' })
    }
    if (counts.pastoralOpen > 0) {
      todos.push({ href: '/admin/pastoral', label: '牧養關懷待跟進', count: counts.pastoralOpen, tone: 'warning' })
    }
    // ops.attention > 0 ⟺ the pipeline is 異常 (attention folds in due_backlog_stale).
    if (counts.ops && counts.ops.attention > 0) {
      todos.push({ href: '/admin/ops', label: '通知系統異常', count: counts.ops.attention, tone: 'danger' })
    }
  }

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
            <span>資料時間 {formatSnapshot(snapshotAt)}</span>
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
            目前沒有待辦事項 🎉
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {todos.map(t => (
              <TodoRow key={t.href} href={t.href} label={t.label} count={t.count} tone={t.tone} />
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
