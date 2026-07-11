import Link from 'next/link'
import LogoutButton from './LogoutButton'

// Back-office home: nav skeleton. Sections ship one slice at a time — the greyed
// cards are the agreed Phase 8 map, kept visible so operators see what's coming.
const PLANNED = [
  { title: '會友與資格管理', note: '查詢、資格檢視／審查、發綁定碼' },
  { title: '名單匯入', note: 'P2 申請表 CSV 上傳' },
  { title: '營運狀態', note: '通知佇列健康度、失敗重送' },
  { title: '牧養關懷', note: '連續未到提醒處理' },
  { title: '現場 PIN 管理', note: '主日現場頁 PIN 設定' },
]

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

        {PLANNED.map(card => (
          <div
            key={card.title}
            className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 opacity-60"
          >
            <h2 className="flex items-center gap-2 text-lg font-medium text-slate-300">
              {card.title}
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-normal text-slate-500">
                規劃中
              </span>
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">{card.note}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
