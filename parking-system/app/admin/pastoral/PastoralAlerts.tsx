'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { OpenAlertItem, ResolvedAlertItem } from '@/server/services/pastoralAlertService'

// Pastoral-care alert handling (sensitive: names + absence counts + notes). All content
// renders as PLAIN TEXT ONLY (no dangerouslySetInnerHTML), never enters a URL, and the
// resolved section is a fixed recent-20 window — no unbounded loading, no export.

const REASON_LABEL: Record<string, string> = {
  consecutive_no_show: '連續未到（P1/P2）',
}

export default function PastoralAlerts({
  open,
  openHasMore,
  recentResolved,
  resolvedHasMore,
}: {
  open: OpenAlertItem[]
  openHasMore: boolean
  recentResolved: ResolvedAlertItem[]
  resolvedHasMore: boolean
}) {
  const router = useRouter()
  const [target, setTarget] = useState<OpenAlertItem | null>(null)
  const [note, setNote] = useState('')
  const [resetCounter, setResetCounter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function openDialog(item: OpenAlertItem) {
    setTarget(item); setNote(''); setResetCounter(false); setError(null); setDone(null)
  }
  function closeDialog() {
    setTarget(null); setNote(''); setResetCounter(false); setError(null)
  }

  async function doResolve() {
    if (busy || !target) return
    if ([...note.trim()].length > 200) { setError('備註最多 200 字'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/pastoral/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alertId: target.id,
          ...(note.trim() ? { note: note.trim() } : {}),
          resetCounter,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setDone(`已結案：${target.displayName}${data.counterReset ? '（計數已歸零）' : ''}`)
        closeDialog()
        router.refresh()
      } else if (res.status === 409) {
        setError('這筆提醒已由其他人處理，畫面將更新。')
        router.refresh()
      } else if (res.status === 404) {
        setError('找不到這筆提醒，畫面將更新。')
        router.refresh()
      } else {
        setError('結案失敗，請再試一次。')
      }
    } catch {
      setError('連線失敗，請再試一次。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header>
        <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">← 管理後台</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">牧養關懷</h1>
        <p className="mt-1 text-sm text-slate-400">
          連續未到提醒。性質為關心而非懲罰——建議先由牧長／幹事聯繫了解狀況，再回來結案。
        </p>
      </header>

      {done && (
        <p className="rounded-2xl border border-emerald-800 bg-emerald-950/30 px-5 py-3 text-sm text-emerald-300">{done}</p>
      )}

      {/* Open alerts */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">待處理{openHasMore ? '（僅顯示前 100 筆）' : ''}</h2>
        {open.length === 0 ? (
          <p className="rounded-2xl border border-emerald-800 bg-emerald-950/30 px-5 py-3 text-sm text-emerald-300">
            目前沒有待處理的關懷提醒
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map(item => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-800/60 bg-slate-900/60 p-5">
                <div>
                  <p className="text-base font-medium text-slate-100">{item.displayName}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {REASON_LABEL[item.reason] ?? item.reason}・開立時連續 {item.triggerCount} 次・目前連續{' '}
                    {item.currentConsecutiveNoShow === null ? '（無計數資料）' : `${item.currentConsecutiveNoShow} 次`}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    觸發週次：{item.sunday}・開立於 {item.createdAt.slice(0, 10)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openDialog(item)}
                  className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
                >
                  處理
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Resolve dialog */}
      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="text-lg font-medium">結案：{target.displayName}</h3>
            <p className="text-sm text-slate-400">
              {REASON_LABEL[target.reason] ?? target.reason}・開立時連續 {target.triggerCount} 次・目前連續{' '}
              {target.currentConsecutiveNoShow === null ? '（無計數資料）' : `${target.currentConsecutiveNoShow} 次`}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">備註（選填，最多 200 字；請勿填入電話等個資）</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={resetCounter}
                onChange={e => setResetCounter(e.target.checked)}
                className="mt-1"
              />
              <span>
                同時歸零連續未到計數
                <span className="block text-xs text-slate-500">
                  歸零後需再連續未到 4 次才會再次提醒；不歸零則下次未到會立即再開提醒。不影響違規分數。
                </span>
              </span>
            </label>
            {error && <p className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">{error}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={busy}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={doResolve}
                disabled={busy}
                className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {busy ? '處理中…' : '確認結案'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recently resolved (fixed window) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">近期已處理{resolvedHasMore ? '（僅顯示最近 20 筆）' : ''}</h2>
        {recentResolved.length === 0 ? (
          <p className="text-sm text-slate-500">尚無已處理紀錄</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentResolved.map(item => (
              <li key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-sm">
                <p className="text-slate-200">
                  {item.displayName}
                  <span className="text-slate-500">
                    ・{REASON_LABEL[item.reason] ?? item.reason}・週次 {item.sunday}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.resolvedAt ? `結案於 ${item.resolvedAt.slice(0, 10)}` : '—'}
                  ・處理者：{item.resolvedByUsername ?? '—'}
                  {item.counterReset ? '・已歸零計數' : ''}
                </p>
                {item.note && <p className="mt-1 text-xs text-slate-400">備註：{item.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
