import Link from 'next/link'
import LogoutButton from './LogoutButton'

// Back-office home: nav skeleton. All Phase 8 sections have shipped (Slice 8 turned
// the last two planned cards — 牧養關懷 / 現場 PIN 管理 — live).
export default function AdminHome({ username }: { username: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-6 py-10 text-slate-100">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">管理後台</h1>
          <p className="mt-1 text-sm text-slate-400">{username}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/bindings"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">綁定審核</h2>
          <p className="mt-1.5 text-sm text-slate-400">審核會友的 LINE 綁定申請（核准／退回）</p>
        </Link>

        <Link
          href="/admin/members"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">會友管理</h2>
          <p className="mt-1.5 text-sm text-slate-400">查詢會友、檢視明細、發放綁定碼</p>
        </Link>

        <Link
          href="/admin/accounts"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">帳號管理</h2>
          <p className="mt-1.5 text-sm text-slate-400">管理 admin 帳號：停用、重設密碼、撤銷登入</p>
        </Link>

        <Link
          href="/admin/eligibility"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">資格審查</h2>
          <p className="mt-1.5 text-sm text-slate-400">P2 資格到期檢視與覆核</p>
        </Link>

        <Link
          href="/admin/import"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">名單匯入</h2>
          <p className="mt-1.5 text-sm text-slate-400">P2 申請表 CSV 上傳</p>
        </Link>

        <Link
          href="/admin/ops"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">營運狀態</h2>
          <p className="mt-1.5 text-sm text-slate-400">通知佇列健康度、失敗重送</p>
        </Link>

        <Link
          href="/admin/pastoral"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">牧養關懷</h2>
          <p className="mt-1.5 text-sm text-slate-400">連續未到提醒處理</p>
        </Link>

        <Link
          href="/admin/staff-pin"
          className="rounded-2xl border border-sky-800 bg-slate-900 p-5 transition-colors hover:border-sky-500"
        >
          <h2 className="text-lg font-medium text-sky-300">現場 PIN 管理</h2>
          <p className="mt-1.5 text-sm text-slate-400">主日現場頁 PIN 設定與解鎖</p>
        </Link>
      </section>
    </main>
  )
}
