'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Badge from '../../ui/Badge'

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
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 bg-page px-6 py-10 text-ink">
      <header>
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">← 管理後台</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">會友管理</h1>
      </header>

      <form onSubmit={submit} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(null) }}
          placeholder="姓名 / 電話 / 車牌"
          maxLength={50}
          autoComplete="off"
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length === 0}
          className="inline-flex min-h-11 items-center rounded-xl bg-primary px-6 text-base font-semibold text-white transition-colors active:bg-primary-strong disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {loading ? '查詢中…' : '查詢'}
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-danger-fg/30 bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</p>
      )}

      {items !== null && (
        items.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-6 py-12 text-center text-muted">
            查無符合的會友
          </p>
        ) : (
          <>
            {hasMore && (
              <p className="rounded-xl border border-warning-fg/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
                結果過多，僅顯示前 {items.length} 筆——請縮小關鍵字。
              </p>
            )}
            <div className="w-full overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th className="px-4 py-3 font-normal">姓名</th>
                    <th className="whitespace-nowrap px-4 py-3 font-normal">電話</th>
                    <th className="whitespace-nowrap px-4 py-3 font-normal">車牌</th>
                    <th className="whitespace-nowrap px-4 py-3 font-normal">角色</th>
                    <th className="whitespace-nowrap px-4 py-3 font-normal">綁定</th>
                    <th className="px-4 py-3 font-normal"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map(m => (
                    <tr key={m.id} className="bg-surface">
                      <td className="px-4 py-3 text-ink">{m.displayName}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-muted">{m.phoneMasked}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-ink">{m.plateSummary || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{ROLE_LABEL[m.role] ?? m.role}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {m.bound ? (
                          <Badge variant="outline" tone="success">已綁定</Badge>
                        ) : (
                          <Badge variant="outline" tone="neutral">未綁定</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/members/${m.id}`)}
                          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
