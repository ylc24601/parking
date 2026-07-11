'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Admin member search. Results show a MASKED phone; the full number is only on the
// session-gated detail page. The query is POSTed (never a URL/query string).

interface SearchItem {
  id: string
  displayName: string
  phoneMasked: string
  plateSummary: string
  role: string
  bound: boolean
}

const ROLE_LABEL: Record<string, string> = {
  user: '會友',
  full_time_staff: '全職同工',
  staff: '同工',
  admin: '管理員',
}

export default function MemberSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchItem[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (trimmed.length === 0 || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/members/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setItems(data.items as SearchItem[])
        setHasMore(Boolean(data.hasMore))
      } else {
        setItems(null)
        setError(res.status === 400 ? '請輸入 1–50 字的關鍵字' : '查詢失敗，請再試一次')
      }
    } catch {
      setItems(null)
      setError('連線失敗，請再試一次')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header>
        <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">← 管理後台</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">會友管理</h1>
      </header>

      <form onSubmit={submit} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(null) }}
          placeholder="姓名 / 電話 / 車牌"
          maxLength={50}
          autoComplete="off"
          className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="rounded-xl bg-sky-600 px-6 py-3 text-base font-medium text-white active:bg-sky-500 disabled:opacity-50"
        >
          {loading ? '查詢中…' : '查詢'}
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">{error}</p>
      )}

      {items !== null && (
        items.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center text-slate-400">
            查無符合的會友
          </p>
        ) : (
          <>
            {hasMore && (
              <p className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
                結果過多，僅顯示前 {items.length} 筆——請縮小關鍵字。
              </p>
            )}
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-normal">姓名</th>
                    <th className="px-4 py-3 font-normal">電話</th>
                    <th className="px-4 py-3 font-normal">車牌</th>
                    <th className="px-4 py-3 font-normal">角色</th>
                    <th className="px-4 py-3 font-normal">綁定</th>
                    <th className="px-4 py-3 font-normal"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {items.map(m => (
                    <tr key={m.id} className="bg-slate-950/40">
                      <td className="px-4 py-3 text-slate-100">{m.displayName}</td>
                      <td className="px-4 py-3 font-mono text-slate-400">{m.phoneMasked}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">{m.plateSummary || '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{ROLE_LABEL[m.role] ?? m.role}</td>
                      <td className="px-4 py-3">
                        {m.bound ? (
                          <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-xs text-emerald-300">已綁定</span>
                        ) : (
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">未綁定</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/members/${m.id}`)}
                          className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600"
                        >
                          明細
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </main>
  )
}
