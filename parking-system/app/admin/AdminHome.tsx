import Link from 'next/link'
import LogoutButton from './LogoutButton'

// Back-office home: nav skeleton. All Phase 8 sections have shipped (Slice 8 turned
// the last two planned cards — 牧養關懷 / 現場 PIN 管理 — live).
const CARDS: Array<{ href: string; title: string; desc: string }> = [
  { href: '/admin/bindings', title: '綁定審核', desc: '審核會友的 LINE 綁定申請（核准／退回）' },
  { href: '/admin/members', title: '會友管理', desc: '查詢會友、檢視明細、發放綁定碼' },
  { href: '/admin/accounts', title: '帳號管理', desc: '管理 admin 帳號：停用、重設密碼、撤銷登入' },
  { href: '/admin/eligibility', title: '資格審查', desc: 'P2 資格到期檢視與覆核' },
  { href: '/admin/import', title: '名單匯入', desc: 'P2 申請表 CSV 上傳' },
  { href: '/admin/ops', title: '營運狀態', desc: '通知佇列健康度、失敗重送' },
  { href: '/admin/pastoral', title: '牧養關懷', desc: '連續未到提醒處理' },
  { href: '/admin/staff-pin', title: '現場 PIN 管理', desc: '主日現場頁 PIN 設定與解鎖' },
]

export default function AdminHome({ username }: { username: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 bg-page px-6 py-10 text-ink">
      <header className="flex items-center justify-between border-b-2 border-primary pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">管理後台</h1>
          <p className="mt-1 text-sm text-muted">{username}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(c => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <h2 className="text-lg font-semibold text-primary">{c.title}</h2>
            <p className="mt-1.5 text-sm text-muted">{c.desc}</p>
          </Link>
        ))}
      </section>
    </main>
  )
}
