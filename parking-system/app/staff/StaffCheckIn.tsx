'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizePlate } from '@/lib/plate'
import { saveStaffCache, loadStaffCache, clearStaffCache, isCacheCurrent } from '@/lib/staffCache'
import {
  type StaffRow,
  DONE_STATUSES,
  rowName,
  rowPlate,
  isWalkIn,
  sundayLabel,
} from '@/lib/staffRow'

export type { StaffRow }

const UNDO_MS = 5000

interface EventInfo {
  id: string
  sunday_date: string
  status: string
}

type Filter = 'all' | 'pending' | 'done' | 'released'

function toStaffRow(r: StaffRow & { weekly_event_id?: string }): StaffRow {
  return {
    reservation_id: r.reservation_id,
    display_name: r.display_name,
    license_plate: r.license_plate,
    walk_in_name: r.walk_in_name,
    walk_in_license_plate: r.walk_in_license_plate,
    is_priority: r.is_priority,
    status: r.status,
    attended_at: r.attended_at,
  }
}

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Taipei',
})
function attendedTime(iso: string | null): string {
  return iso ? timeFmt.format(new Date(iso)) : ''
}

export default function StaffCheckIn({
  initialEvent,
  initialRows,
}: {
  initialEvent: EventInfo | null
  initialRows: StaffRow[]
}) {
  const router = useRouter()
  const [rows, setRows] = useState<StaffRow[]>(initialRows)
  const [event, setEvent] = useState<EventInfo | null>(initialEvent)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [toast, setToast] = useState<string | null>(null)
  // Connectivity: set on fetch failure / 'offline' event; cleared ONLY by a
  // successful reload (the 'online' event just triggers a retry).
  const [offline, setOffline] = useState(false)
  const [noCurrentList, setNoCurrentList] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [walkInPlate, setWalkInPlate] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [walkInBusy, setWalkInBusy] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [settleBusy, setSettleBusy] = useState(false)

  // Undo-window state lives in refs so the setTimeout never reads stale state.
  const pendingRef = useRef<{
    reservationId: string
    prevStatus: string
    prevAttendedAt: string | null
  } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When the shown list was last confirmed (server fetch or cache). Rendered in the
  // offline banner → must be state. Initialized from props (only read post-mount).
  const [lastUpdated, setLastUpdated] = useState<string | null>(() =>
    initialEvent && initialRows.length > 0 ? new Date().toISOString() : null,
  )

  const isOffline = () =>
    offline || (typeof navigator !== 'undefined' && navigator.onLine === false)

  // Manual refresh re-pulls the list (event handler → setState-in-effect rule N/A).
  async function reload(opts?: { silent?: boolean }): Promise<boolean> {
    if (refreshing) return false
    setRefreshing(true)
    try {
      const res = await fetch('/api/staff/checkin-list')
      if (res.status === 401) {
        router.refresh() // session gone → back to PIN
        return false
      }
      if (!res.ok) throw new Error('load failed')
      const data = (await res.json()) as {
        event: EventInfo | null
        rows: (StaffRow & { weekly_event_id?: string })[]
      }
      const fresh = data.rows.map(toStaffRow)
      setEvent(data.event)
      setRows(fresh)
      if (data.event) saveStaffCache(data.event, fresh) // confirmed → cache
      setLastUpdated(new Date().toISOString())
      setOffline(false)
      setNoCurrentList(false)
      return true
    } catch {
      // Network failure → degraded/offline. Keep the current in-memory list;
      // only fall back to cache if the screen has nothing to show.
      setOffline(true)
      if (rows.length === 0) {
        const c = loadStaffCache()
        if (c && isCacheCurrent(c)) {
          setRows(c.rows)
          setEvent({ id: c.event.id, sunday_date: c.event.sunday_date, status: '' })
          setLastUpdated(c.cachedAt)
          setNoCurrentList(false)
        } else {
          setNoCurrentList(true) // stale week / no cache → don't fake today's list
        }
      }
      if (!opts?.silent) setToast('更新失敗，顯示的是最後一次資料')
      return false
    } finally {
      setRefreshing(false)
    }
  }

  // A write returned 409 event_finalized → the week closed under us. Flip the whole
  // screen into the finalized read-only state. Returns true if it was that 409.
  async function applyFinalized409(res: Response): Promise<boolean> {
    if (res.status !== 409) return false
    const body = (await res.clone().json().catch(() => null)) as { error?: string } | null
    if (body?.error !== 'event_finalized') return false
    setEvent(e => (e ? { ...e, status: 'finalized' } : e))
    setToast('本週已結束')
    return true
  }

  // ── Undo-window check-in ─────────────────────────────────────────────────────
  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // Commit the pending check-in to the server (called by the timer, by tapping a
  // different row, or before logout). Idempotent server-side; reconciles status.
  async function commitPending(): Promise<boolean> {
    const p = pendingRef.current
    if (!p) return true
    pendingRef.current = null
    clearTimer()
    setPendingName(null)
    try {
      const res = await fetch('/api/staff/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: p.reservationId }),
      })
      if (res.status === 401) {
        router.refresh()
        return false
      }
      if (await applyFinalized409(res)) {
        // Week closed under us — roll back the optimistic row, go read-only.
        setRows(rs =>
          rs.map(x =>
            x.reservation_id === p.reservationId
              ? { ...x, status: p.prevStatus, attended_at: p.prevAttendedAt }
              : x,
          ),
        )
        return false
      }
      if (!res.ok) throw new Error('checkin failed')
      const data = (await res.json()) as { status: string }
      const next = rows.map(x =>
        x.reservation_id === p.reservationId ? { ...x, status: data.status } : x,
      )
      setRows(next)
      setOffline(false)
      if (event) saveStaffCache(event, next) // confirmed → cache
      return true
    } catch {
      setRows(rs =>
        rs.map(x =>
          x.reservation_id === p.reservationId
            ? { ...x, status: p.prevStatus, attended_at: p.prevAttendedAt }
            : x,
        ),
      )
      setOffline(true)
      setToast('點名失敗，請重試')
      return false
    }
  }

  function tapCheckIn(r: StaffRow) {
    if (settleBusy) return // settlement in flight → block concurrent writes
    if (finalized) {
      setToast('本週已結束，無法點名')
      return
    }
    if (isOffline()) {
      setToast('目前離線，請恢復網路後再操作')
      return
    }
    // Flush any previous pending first (one undo window at a time).
    if (pendingRef.current) void commitPending()

    const targetStatus = r.status === 'released_late' ? 'attended_after_release' : 'attended'
    setRows(rs =>
      rs.map(x =>
        x.reservation_id === r.reservation_id
          ? { ...x, status: targetStatus, attended_at: new Date().toISOString() }
          : x,
      ),
    )
    pendingRef.current = {
      reservationId: r.reservation_id,
      prevStatus: r.status,
      prevAttendedAt: r.attended_at,
    }
    setPendingName(rowName(r))
    timerRef.current = setTimeout(() => void commitRef.current(), UNDO_MS)
  }

  function undo() {
    const p = pendingRef.current
    if (!p) return
    clearTimer()
    pendingRef.current = null
    setPendingName(null)
    setRows(rs =>
      rs.map(x =>
        x.reservation_id === p.reservationId
          ? { ...x, status: p.prevStatus, attended_at: p.prevAttendedAt }
          : x,
      ),
    )
  }

  // "Latest callback" refs so the timer / window listeners use current state.
  const commitRef = useRef(commitPending)
  const reloadRef = useRef(reload)
  useEffect(() => {
    commitRef.current = commitPending
    reloadRef.current = reload
  })

  // Connectivity listeners + one-time confirmed cache write of the SSR data.
  useEffect(() => {
    if (initialEvent && initialRows.length > 0) saveStaffCache(initialEvent, initialRows)
    const goOffline = () => setOffline(true)
    const goOnline = () => void reloadRef.current() // may retry; reload success clears offline
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      clearTimer()
    }
  }, [initialEvent, initialRows])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const attendedCount = useMemo(() => rows.filter(r => DONE_STATUSES.has(r.status)).length, [rows])
  // Currently-visible released-late count for the confirm sheet. The actual number
  // settled may differ — settle() runs a final release sweep server-side first.
  const releasedLateCount = useMemo(
    () => rows.filter(r => r.status === 'released_late').length,
    [rows],
  )
  // A finalized event is a terminal, read-only week: all writes are blocked.
  const finalized = event?.status === 'finalized'

  const visibleRows = useMemo(() => {
    const q = normalizePlate(query)
    return rows.filter(r => {
      if (filter === 'pending' && r.status !== 'approved') return false
      if (filter === 'released' && r.status !== 'released_late') return false
      if (filter === 'done' && !DONE_STATUSES.has(r.status)) return false
      if (q) {
        const plate = normalizePlate(rowPlate(r))
        if (!plate.includes(q)) return false
      }
      return true
    })
  }, [rows, query, filter])

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '未到' },
    { key: 'done', label: '已到' },
    { key: 'released', label: '已釋出' },
  ]

  async function logout() {
    await commitPending() // best-effort flush of an un-sent check-in
    clearStaffCache() // don't leave Staff-safe data on a shared device
    await fetch('/api/staff/logout', { method: 'POST' })
    router.refresh()
  }

  function openWalkIn(prefillPlate = '') {
    if (settleBusy || finalized) return
    setWalkInPlate(prefillPlate)
    setWalkInName('')
    setWalkInOpen(true)
  }

  async function submitWalkIn() {
    const plate = walkInPlate.trim()
    if (!plate || walkInBusy || settleBusy || finalized) return
    if (isOffline()) {
      setToast('目前離線，請恢復網路後再操作')
      return
    }
    setWalkInBusy(true)
    try {
      const res = await fetch('/api/staff/walkins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ license_plate: plate, walk_in_name: walkInName.trim() || null }),
      })
      if (res.status === 401) {
        router.refresh()
        return
      }
      if (await applyFinalized409(res)) {
        setWalkInOpen(false)
        return
      }
      if (res.status === 409) {
        setToast('此車牌已在清單')
        return
      }
      if (!res.ok) throw new Error('walkin failed')
      const data = (await res.json()) as { row: StaffRow & { weekly_event_id?: string } }
      const next = [toStaffRow(data.row), ...rows]
      setRows(next)
      if (event) saveStaffCache(event, next) // confirmed → cache
      setWalkInOpen(false)
      setQuery('')
      setToast('已登記現場車輛')
    } catch {
      setOffline(true)
      setToast('登記失敗，請重試')
    } finally {
      setWalkInBusy(false)
    }
  }

  // 結束當週點名: settle still-released_late rows into no_show (server applies the
  // no-show/pastoral rules — none of which surface here). Irreversible → confirmed.
  async function submitSettle() {
    if (settleBusy || finalized) return
    if (isOffline()) {
      setToast('目前離線，請恢復網路後再操作')
      return
    }
    // Flush an un-sent undo check-in first; if it can't be committed, abort settle
    // so a not-yet-saved attendance isn't swept into a no-show.
    const flushed = await commitPending()
    if (!flushed) {
      setToast('尚有點名未送出，請重試')
      return
    }
    setSettleBusy(true)
    try {
      const res = await fetch('/api/staff/settle', { method: 'POST' })
      if (res.status === 401) {
        router.refresh()
        return
      }
      if (await applyFinalized409(res)) {
        // Already finalized (e.g. another device) → go read-only.
        setSettleOpen(false)
        return
      }
      if (!res.ok) {
        // Server/HTTP error is NOT the same as being offline — don't flip offline.
        setToast('結算失敗，請重試')
        return
      }
      const data = (await res.json()) as { settled: number; finalized: boolean }
      if (!data.finalized) {
        // Settlement succeeded but the week didn't close. settle() is idempotent,
        // so this is retryable — don't go read-only, don't claim full failure.
        setToast('結束本週失敗，請重新整理後再試')
        return
      }
      setSettleOpen(false)
      setEvent(e => (e ? { ...e, status: 'finalized' } : e)) // flip to read-only now
      const successMsg = `已結束本週點名（本次結算 ${data.settled} 台未到）`
      // Settle succeeded — refresh the list (settled rows become no_show and drop
      // out of the Staff list). Keep the success toast even if the reload fails.
      const reloaded = await reload({ silent: true })
      setToast(reloaded ? successMsg : `${successMsg} · 清單重新整理失敗，請稍後重新整理`)
    } catch {
      // Genuine network failure → degraded/offline.
      setOffline(true)
      setToast('結算失敗，請重試')
    } finally {
      setSettleBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{event ? sundayLabel(event.sunday_date) : '現場點名'}</h1>
          <div className="flex items-center gap-3">
            <span className="text-base tabular-nums text-slate-300">
              已到 {attendedCount} / {rows.length}
            </span>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={refreshing}
              aria-label="重新整理"
              className="rounded-lg px-2 py-1 text-sm text-slate-400 active:bg-slate-800 disabled:opacity-50"
            >
              🔄
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg px-2 py-1 text-sm text-slate-400 active:bg-slate-800"
            >
              登出
            </button>
          </div>
        </div>

        <input
          inputMode="numeric"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="🔍 輸入車牌後四碼…"
          className="mt-3 h-12 w-full rounded-xl bg-slate-900 px-4 text-base text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-sky-500"
        />

        <div className="mt-3 flex gap-2">
          {chips.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filter === c.key ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </header>

      {offline && (
        <div className="border-b border-amber-900 bg-amber-950/60 px-4 py-2 text-center text-sm text-amber-200">
          離線中
          {lastUpdated ? ` · 資料更新於 ${attendedTime(lastUpdated)}` : '，請恢復網路後重新整理'}
          {lastUpdated && event ? `（${sundayLabel(event.sunday_date)}）` : ''}
        </div>
      )}

      {finalized && (
        <div className="border-b border-slate-700 bg-slate-800/80 px-4 py-2 text-center text-sm text-slate-300">
          本週點名已結束，僅供檢視
        </div>
      )}

      {/* List */}
      <section className="flex-1 px-4">
        {noCurrentList ? (
          <p className="py-16 text-center text-slate-400">
            尚未下載本週清單，請恢復網路後重新整理
          </p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-slate-400">
            {event ? '本週尚無核准車輛' : '尚未開放本週點名'}
          </p>
        ) : visibleRows.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            {query ? (
              <>
                <p>找不到符合車牌</p>
                <button
                  type="button"
                  onClick={() => openWalkIn(query)}
                  className="mt-4 h-12 rounded-xl bg-emerald-700 px-5 text-base font-medium text-white active:bg-emerald-800"
                >
                  ＋ 登記為現場車輛
                </button>
              </>
            ) : attendedCount === rows.length ? (
              <p>全部車輛已到 🎉</p>
            ) : (
              <p>沒有符合的車輛</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {visibleRows.map(r => {
              const done = DONE_STATUSES.has(r.status)
              const released = r.status === 'released_late'
              return (
                <li key={r.reservation_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">
                      {r.is_priority && <span aria-label="優先車位">⭐ </span>}
                      {rowName(r)}
                      {isWalkIn(r) && <span className="ml-1 text-sm text-slate-500">· 現場</span>}
                    </p>
                    <p className="mt-0.5 font-mono text-base tracking-wide text-slate-300">
                      {rowPlate(r)}
                    </p>
                    <p className="mt-0.5 text-sm">
                      {done ? (
                        <span className="text-emerald-400">
                          ✅ 已到{attendedTime(r.attended_at) && ` ${attendedTime(r.attended_at)}`}
                          {r.status === 'attended_after_release' && '（補）'}
                        </span>
                      ) : released ? (
                        <span className="text-amber-400">⏰ 已釋出</span>
                      ) : (
                        <span className="text-slate-400">未到場</span>
                      )}
                    </p>
                  </div>

                  {!done && (
                    <button
                      type="button"
                      onClick={() => tapCheckIn(r)}
                      disabled={finalized}
                      className={`h-12 shrink-0 rounded-xl px-5 text-base font-medium disabled:opacity-40 ${
                        released ? 'bg-amber-600 text-white active:bg-amber-700' : 'bg-sky-600 text-white active:bg-sky-700'
                      }`}
                    >
                      {released ? '補點名' : '點名'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="space-y-2 border-t border-slate-800 px-4 py-4">
        <button
          type="button"
          onClick={() => openWalkIn()}
          disabled={finalized}
          className="h-12 w-full rounded-xl bg-emerald-700 text-base font-medium text-white active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ＋ 登記現場車輛
        </button>
        {/* Printable paper backup — prepared before service, while online. */}
        <a
          href="/staff/print"
          target="_blank"
          rel="noopener"
          className="flex h-12 w-full items-center justify-center rounded-xl border border-slate-700 text-base text-slate-300 active:bg-slate-800"
        >
          🖨 列印備援清單
        </a>
        {/* End-of-service settlement: settles released-late no-shows (irreversible). */}
        <button
          type="button"
          onClick={() => setSettleOpen(true)}
          disabled={!event || finalized || settleBusy || offline}
          className="h-12 w-full rounded-xl border border-slate-700 text-base text-slate-200 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✔ 結束當週點名
        </button>
      </footer>

      {walkInOpen && (
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/50">
          <button
            type="button"
            aria-label="關閉"
            className="flex-1"
            onClick={() => !walkInBusy && setWalkInOpen(false)}
          />
          <div className="mx-auto w-full max-w-md rounded-t-2xl border-t border-slate-700 bg-slate-900 px-4 pb-6 pt-4">
            <h2 className="text-lg font-semibold">登記現場車輛</h2>
            <label className="mt-4 block text-sm text-slate-400">車牌 *</label>
            <input
              autoFocus
              value={walkInPlate}
              onChange={e => setWalkInPlate(e.target.value)}
              placeholder="例：ABC-1234"
              className="mt-1 h-12 w-full rounded-xl bg-slate-800 px-4 text-base text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <label className="mt-3 block text-sm text-slate-400">姓名／備註（選填）</label>
            <input
              value={walkInName}
              onChange={e => setWalkInName(e.target.value)}
              className="mt-1 h-12 w-full rounded-xl bg-slate-800 px-4 text-base text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                disabled={walkInBusy}
                className="h-12 flex-1 rounded-xl bg-slate-800 text-base text-slate-200 active:bg-slate-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitWalkIn()}
                disabled={walkInBusy || walkInPlate.trim() === ''}
                className="h-12 flex-1 rounded-xl bg-emerald-600 text-base font-medium text-white active:bg-emerald-700 disabled:opacity-50"
              >
                確認登記
              </button>
            </div>
          </div>
        </div>
      )}

      {settleOpen && (
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/50">
          <button
            type="button"
            aria-label="關閉"
            className="flex-1"
            onClick={() => !settleBusy && setSettleOpen(false)}
          />
          <div className="mx-auto w-full max-w-md rounded-t-2xl border-t border-slate-700 bg-slate-900 px-4 pb-6 pt-4">
            <h2 className="text-lg font-semibold">結束本週點名</h2>
            <p className="mt-3 text-sm text-slate-300">
              目前有 {releasedLateCount} 台已釋出未到將被結算。
            </p>
            <p className="mt-2 text-sm text-slate-300">
              將所有「已釋出未到」標記為未到並結束本週點名，<span className="font-semibold text-rose-300">此動作無法復原</span>。
            </p>
            <p className="mt-2 text-xs text-slate-500">
              實際結算台數可能不同：系統會先做一次最終釋出掃描再結算。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setSettleOpen(false)}
                disabled={settleBusy}
                className="h-12 flex-1 rounded-xl bg-slate-800 text-base text-slate-200 active:bg-slate-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitSettle()}
                disabled={settleBusy}
                className="h-12 flex-1 rounded-xl bg-rose-600 text-base font-medium text-white active:bg-rose-700 disabled:opacity-50"
              >
                {settleBusy ? '結算中…' : '確認結束'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingName && (
        <div className="fixed inset-x-0 bottom-28 z-30 mx-auto flex w-fit items-center gap-3 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100 shadow-lg">
          <span>已點名 {pendingName} · 尚未送出</span>
          <button type="button" onClick={undo} className="font-semibold text-sky-400 active:text-sky-300">
            復原
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-rose-600 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  )
}
