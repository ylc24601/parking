import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/server/http/adminAuth'
import {
  listEligibilityReview,
  type EligibilityReviewItem,
  type ReviewListStatus,
} from '@/server/services/eligibilityReviewService'

export const metadata: Metadata = {
  title: '資格審查 · 管理後台',
}

// Read-only P2 eligibility review. Rows carry names + P2 reasons (health-adjacent
// sensitive info), so gate on the session and never cache. No phone / dependent names
// reach this page — identify by name and open the detail page for the rest.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const REASON_LABEL: Record<string, string> = {
  mobility_long: '行動不便（長期）', mobility_short: '行動不便（短期）',
  child_companion: '幼兒同行', pregnancy: '孕婦', elderly_companion: '長者同行',
}

const SECTIONS: { status: ReviewListStatus; title: string; hint: string }[] = [
  { status: 'expired', title: '已過期', hint: '資格已失效，目前套用中會掉回 P3——需重新核定或更新' },
  { status: 'review_due', title: '待覆核', hint: '覆核日已到（含匯入時缺日期者）' },
  { status: 'upcoming', title: '60 天內到期或需覆核', hint: '尚未過期，但覆核／到期日將在 60 天內' },
]

export default async function AdminEligibilityPage() {
  if (!(await getAdminSession())) redirect('/admin')

  const { items, hasMore, counts } = await listEligibilityReview()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header>
        <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">← 管理後台</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">P2 資格審查</h1>
        <p className="mt-1 text-sm text-slate-400">
          {hasMore ? '目前顯示（最急迫前 500 筆）：' : ''}
          已過期 {counts.expired} · 待覆核 {counts.review_due} · 60 天內 {counts.upcoming}
        </p>
      </header>

      {hasMore && (
        <p className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          結果超過 500 筆；以下計數與清單僅包含最急迫的前 500 筆。
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center text-slate-400">
          目前沒有需要處理的資格
        </p>
      ) : (
        SECTIONS.map(section => {
          const rows = items.filter(i => i.status === section.status)
          if (rows.length === 0) return null
          return (
            <section key={section.status} className="flex flex-col gap-2">
              <div>
                <h2 className="text-lg font-medium text-slate-200">{section.title}（{rows.length}）</h2>
                <p className="text-xs text-slate-500">{section.hint}</p>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-normal">姓名</th>
                      <th className="px-4 py-3 font-normal">事由</th>
                      <th className="px-4 py-3 font-normal">有效至</th>
                      <th className="px-4 py-3 font-normal">覆核日</th>
                      <th className="px-4 py-3 font-normal">最近覆核</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {rows.map(row => (
                      <Row key={row.userId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })
      )}
    </main>
  )
}

function Row({ row }: { row: EligibilityReviewItem }) {
  return (
    <tr className="bg-slate-950/40">
      <td className="px-4 py-3">
        <Link href={`/admin/members/${row.userId}`} className="text-sky-300 hover:text-sky-200">
          {row.displayName}
        </Link>
      </td>
      <td className="px-4 py-3 text-slate-300">{row.reason ? (REASON_LABEL[row.reason] ?? row.reason) : '—'}</td>
      <td className="px-4 py-3 text-slate-400">{row.validUntil ?? '—'}</td>
      <td className="px-4 py-3 text-slate-400">{row.reviewDate ?? '—'}</td>
      <td className="px-4 py-3 text-slate-500">{row.reviewedAt ? row.reviewedAt.slice(0, 10) : '—'}</td>
    </tr>
  )
}
