'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { StaffPinCardStatus } from '@/server/services/staffPinAdminService'

// On-site PIN management: one shared 6-digit PIN per Sunday's weekly_event. The PIN is
// server-generated and shown EXACTLY ONCE — any other action (another issue, an unlock,
// a refresh) clears it from the screen. "解鎖" and "產生新 PIN" are deliberately separate:
// unlock keeps the existing PIN (which cannot be re-displayed); issue replaces it and
// immediately invalidates the old one.

// expires_at rendered in Taipei local time (UTC+8, no DST) — the audience hands the PIN
// to on-site volunteers, so a UTC timestamp would just invite mistakes.
function taipeiTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 3600_000)
  return `${t.toISOString().slice(0, 16).replace('T', ' ')}（台北）`
}

export default function StaffPinManager({
  current,
  next,
}: {
  current: StaffPinCardStatus
  next: StaffPinCardStatus
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The one-time PIN display: kept for exactly one card at a time.
  const [issued, setIssued] = useState<{ sunday: string; pin: string; expiresAt: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null) // sunday awaiting replace-confirm
  const [unlocked, setUnlocked] = useState<string | null>(null)

  function clearTransient() {
    setIssued(null); setConfirming(null); setError(null); setUnlocked(null)
  }

  async function doIssue(card: StaffPinCardStatus) {
    if (busy || !card.eventId) return
    setBusy(true)
    clearTransient()
    try {
      const res = await fetch('/api/admin/staff-pin/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: card.eventId, sunday: card.sunday }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setIssued({ sunday: data.sunday, pin: data.pin, expiresAt: data.expiresAt })
        router.refresh()
      } else {
        setError('產生 PIN 失敗，請重新整理後再試。')
        router.refresh()
      }
    } catch {
      setError('連線失敗，請再試一次。')
    } finally {
      setBusy(false)
    }
  }

  async function doUnlock(card: StaffPinCardStatus) {
    if (busy || !card.eventId) return
    setBusy(true)
    clearTransient()
    try {
      const res = await fetch('/api/admin/staff-pin/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: card.eventId, sunday: card.sunday }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setUnlocked(card.sunday)
        router.refresh()
      } else {
        setError('解鎖失敗，請重新整理後再試。')
        router.refresh()
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
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">現場 PIN 管理</h1>
        <p className="mt-1 text-sm text-slate-400">
          主日現場頁的共用 6 位數 PIN（每主日一組）。PIN 由系統隨機產生、只顯示一次；有效至該主日結束。
        </p>
      </header>

      {error && <p className="rounded-2xl border border-rose-800 bg-rose-950/40 px-5 py-3 text-sm text-rose-300">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {([{ card: current, label: '當週' }, { card: next, label: '下週' }] as const).map(({ card, label }) => (
          <PinCard
            key={card.sunday}
            card={card}
            label={label}
            busy={busy}
            issued={issued}
            unlocked={unlocked}
            confirming={confirming}
            onIssue={() => doIssue(card)}
            onUnlock={() => doUnlock(card)}
            onConfirmStart={() => setConfirming(card.sunday)}
            onConfirmCancel={() => setConfirming(null)}
          />
        ))}
      </div>
    </main>
  )
}

function PinCard({
  card,
  label,
  busy,
  issued,
  unlocked,
  confirming,
  onIssue,
  onUnlock,
  onConfirmStart,
  onConfirmCancel,
}: {
  card: StaffPinCardStatus
  label: string
  busy: boolean
  issued: { sunday: string; pin: string; expiresAt: string } | null
  unlocked: string | null
  confirming: string | null
  onIssue: () => void
  onUnlock: () => void
  onConfirmStart: () => void
  onConfirmCancel: () => void
}) {
  return (
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <header className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">{label}</h2>
          <span className="text-sm text-slate-400">{card.sunday}（週日）</span>
        </header>

        {card.eventId === null ? (
          <p className="text-sm text-slate-500">本週 event 尚未建立（週五分配後產生），暫無法設定 PIN。</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-slate-400">PIN 狀態</dt>
              <dd className={card.hasPin ? 'text-emerald-300' : 'text-slate-300'}>
                {card.hasPin ? '已設定' : '未設定'}
              </dd>
              {card.hasPin && card.expiresAt && (
                <>
                  <dt className="text-slate-400">有效至</dt>
                  <dd className="text-slate-200">{taipeiTime(card.expiresAt)}</dd>
                </>
              )}
              {card.hasPin && (
                <>
                  <dt className="text-slate-400">登入失敗次數</dt>
                  <dd className={card.locked ? 'text-rose-300' : 'text-slate-200'}>
                    {card.failedAttempts}{card.locked ? '（已鎖定）' : ''}
                  </dd>
                </>
              )}
            </dl>

            {issued && issued.sunday === card.sunday && (
              <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
                <p className="text-sm text-emerald-300">新 PIN（只顯示這一次，請以安全管道轉交當週同工）：</p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-emerald-200">{issued.pin}</p>
                <p className="mt-1 text-xs text-emerald-400/80">有效至 {taipeiTime(issued.expiresAt)}</p>
              </div>
            )}

            {unlocked === card.sunday && (
              <p className="rounded-xl border border-emerald-800 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-300">
                已解鎖。原 PIN 維持不變（系統無法再次顯示）。
              </p>
            )}

            {confirming === card.sunday ? (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-800 bg-amber-950/30 p-4">
                <p className="text-sm text-amber-200">
                  將替換 {card.sunday} 的現場 PIN——<strong>舊 PIN 立即失效</strong>。
                  若已把舊 PIN 交給同工，請先確認再繼續。
                  {card.expiresAt && <span className="block text-xs text-amber-300/80">現有 PIN 有效至 {taipeiTime(card.expiresAt)}</span>}
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onConfirmCancel}
                    disabled={busy}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={onIssue}
                    disabled={busy}
                    className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    {busy ? '產生中…' : '確認替換'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={card.hasPin ? onConfirmStart : onIssue}
                  disabled={busy}
                  className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {card.hasPin ? '產生並替換 PIN' : '產生 PIN'}
                </button>
                {card.locked && (
                  <button
                    type="button"
                    onClick={onUnlock}
                    disabled={busy}
                    className="rounded-xl border border-amber-700 px-5 py-2.5 text-sm text-amber-300 hover:border-amber-500 disabled:opacity-50"
                  >
                    解鎖現有 PIN（不變更 PIN）
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
  )
}
