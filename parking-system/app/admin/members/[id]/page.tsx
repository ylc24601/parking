import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/server/http/adminAuth'
import { getMemberDetail, type MemberDetail } from '@/server/services/memberAdminService'
import IssueBindingCode from './IssueBindingCode'

export const metadata: Metadata = {
  title: '會友明細 · 管理後台',
}

// This page renders complete PII (full phone, eligibility reasons, dependent names +
// birthdates). Force it dynamic + uncacheable so none of it is ever stored in a
// prerender / route cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ROLE_LABEL: Record<string, string> = {
  user: '會友', full_time_staff: '全職同工', staff: '同工', admin: '管理員',
}
const REASON_LABEL: Record<string, string> = {
  mobility_long: '行動不便（長期）', mobility_short: '行動不便（短期）',
  child_companion: '幼兒同行', pregnancy: '孕婦', elderly_companion: '長者同行',
}
const DEP_KIND_LABEL: Record<string, string> = { impaired: '身障', child: '幼兒', elder: '長者' }

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) redirect('/admin')

  const { id } = await params
  // Validate BEFORE any DB call — a malformed id must not reach the repository.
  const detail = UUID_FORMAT.test(id) ? await getMemberDetail(id) : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header>
        <Link href="/admin/members" className="text-sm text-slate-400 hover:text-slate-200">← 會友管理</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">會友明細</h1>
      </header>

      {detail === null ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center text-slate-400">
          查無此會友
        </p>
      ) : (
        <DetailBody id={id} detail={detail} />
      )}
    </main>
  )
}

function DetailBody({ id, detail }: { id: string; detail: MemberDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-medium">{detail.displayName}</h2>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            {ROLE_LABEL[detail.role] ?? detail.role}
          </span>
          {detail.bound ? (
            <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-xs text-emerald-300">已綁定 LINE</span>
          ) : (
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">未綁定</span>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="電話">{detail.phone ?? '—'}</Row>
          <Row label="車輛">
            {detail.vehicles.length === 0 ? '—' : (
              <ul className="space-y-0.5">
                {detail.vehicles.map((v, i) => (
                  <li key={i} className="font-mono">
                    {v.plate}{v.nickname ? <span className="ml-2 font-sans text-slate-400">{v.nickname}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-lg font-medium">P2 資格</h3>
        {detail.eligibility === null || !detail.eligibility.p2Eligible ? (
          <p className="mt-2 text-sm text-slate-400">無 P2 資格</p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="事由">{detail.eligibility.p2Reason ? (REASON_LABEL[detail.eligibility.p2Reason] ?? detail.eligibility.p2Reason) : '—'}</Row>
            <Row label="有效至">{detail.eligibility.p2ValidUntil ?? '—'}</Row>
            <Row label="覆核日">{detail.eligibility.p2ReviewDate ?? '—'}</Row>
            <Row label="最近覆核">{detail.eligibility.reviewedAt ? detail.eligibility.reviewedAt.slice(0, 10) : '—'}</Row>
          </dl>
        )}
        {detail.dependents.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm text-slate-400">眷屬</h4>
            <ul className="mt-1 space-y-0.5 text-sm">
              {detail.dependents.map((d, i) => (
                <li key={i}>
                  <span className="text-slate-400">{DEP_KIND_LABEL[d.kind] ?? d.kind}</span>
                  <span className="ml-2">{d.name}</span>
                  {d.birthdate ? <span className="ml-2 text-slate-500">{d.birthdate}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-lg font-medium">綁定碼（fallback 綁定）</h3>
        <IssueBindingCode userId={id} bound={detail.bound} />
      </section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-slate-400">{label}</dt>
      <dd className="text-slate-100">{children}</dd>
    </div>
  )
}
