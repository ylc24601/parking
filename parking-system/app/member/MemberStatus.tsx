'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Member-safe week status DTO, built by the server page from repo rows. Own data
// only — no penalty, no other members, no ids. Dates are ISO strings (client
// formats them in Asia/Taipei). `apply` is present only when the member can see the
// apply block (open week, no live reservation); eligibility itself never ships —
// just the derived companion hint.
export interface MemberWeekStatus {
  displayName: string
  sundayDate: string | null       // 'YYYY-MM-DD'; null = no upcoming week open yet
  reservation: {
    status: string
    plate: string | null
    releaseDeadlineAt: string | null
    offerExpiresAt: string | null
    p2OnTheWay: boolean
  } | null
  apply: {
    closed: boolean               // Friday allocation ran — this week is closed
    staffP1: boolean              // full-time staff: spots managed via weekly reserve
    vehicles: Array<{ id: string; plate: string; nickname: string | null }>
    companionKind: 'elderly' | 'child' | null
  } | null
  canCancel: boolean
  canRespondOffer: boolean        // live temp_approved offer, not yet expired
  canReportOnTheWay: boolean      // approved P2, unattended, before the 10:45 deadline
}

const TAIPEI_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function sundayLabel(sundayDate: string): string {
  const [, m, d] = sundayDate.split('-')
  return `${Number(m)}月${Number(d)}日 主日`
}

function timeLabel(iso: string | null): string | null {
  return iso ? TAIPEI_TIME.format(new Date(iso)) : null
}

// 狀態 → 會友文案。offer 確認/正在路上為 Slice 4。
function statusView(r: NonNullable<MemberWeekStatus['reservation']>): {
  label: string
  tone: 'ok' | 'wait' | 'off'
  detail: string | null
} {
  const deadline = timeLabel(r.releaseDeadlineAt)
  switch (r.status) {
    case 'pending':
      return { label: '已登記，等待分配', tone: 'wait', detail: '週五 18:00 分配後於此頁查看結果' }
    case 'approved':
      return {
        label: '已核准車位',
        tone: 'ok',
        detail: deadline
          ? `請於主日 ${deadline} 前抵達${r.p2OnTheWay ? '（已回報正在路上）' : ''}`
          : null,
      }
    case 'temp_approved':
      return {
        label: '候補遞補中',
        tone: 'wait',
        detail: timeLabel(r.offerExpiresAt)
          ? `已為您保留車位，請於 ${timeLabel(r.offerExpiresAt)} 前回覆`
          : '已為您保留車位，請儘速回覆',
      }
    case 'waiting':
      return { label: '候補中', tone: 'wait', detail: '若有車位釋出將依序遞補並通知您' }
    case 'attended':
      return { label: '已到場', tone: 'ok', detail: null }
    case 'attended_after_release':
      return { label: '已到場（逾時補點名）', tone: 'ok', detail: null }
    case 'released_late':
      return { label: '逾時未到，車位已釋出', tone: 'off', detail: '如已在現場請洽停車同工' }
    case 'no_show':
      return { label: '本週未到場', tone: 'off', detail: null }
    case 'cancelled_by_user':
    case 'cancelled_late':
      return { label: '已取消', tone: 'off', detail: null }
    default:
      return { label: '狀態確認中', tone: 'wait', detail: '請洽停車同工' }
  }
}

const TONE_CLASSES = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  wait: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  off: 'border-slate-600 bg-slate-800/60 text-slate-300',
} as const

const APPLY_ERROR_COPY: Record<string, string> = {
  applications_closed: '本週登記已截止',
  already_applied: '本週已有登記，請重新整理頁面',
  vehicle_not_owned: '車輛資料有誤，請聯繫同工',
  event_not_open: '本週登記已關閉',
  no_open_week: '目前沒有開放中的登記週',
  staff_use_p1: '全職同工車位由每週保留名額管理，無需登記',
  invalid_request: '資料有誤，請重新選擇車輛',
}

export default function MemberStatus({ status }: { status: MemberWeekStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      await fetch('/api/member/logout', { method: 'POST' })
    } finally {
      router.refresh()
    }
  }

  const r = status.reservation
  const view = r ? statusView(r) : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-slate-950 px-5 py-8 text-slate-100">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">教會停車 · 會友專區</h1>
          <p className="mt-1 text-sm text-slate-400">{status.displayName}，平安</p>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="h-12 shrink-0 rounded-xl px-4 text-sm text-slate-400 active:bg-slate-800 disabled:opacity-50"
        >
          登出
        </button>
      </header>

      <section className="mt-8 space-y-4">
        {status.sundayDate === null ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="text-lg">本週登記尚未開放</p>
            <p className="mt-2 text-sm text-slate-400">開放後可在此登記並查看您的停車預約</p>
          </div>
        ) : (
          <>
            {r && view && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <p className="text-sm text-slate-400">{sundayLabel(status.sundayDate)}</p>
                <p
                  className={`mt-3 inline-block rounded-full border px-4 py-1.5 text-base font-medium ${TONE_CLASSES[view.tone]}`}
                >
                  {view.label}
                </p>
                {r.plate && <p className="mt-4 text-2xl font-semibold tracking-wide">{r.plate}</p>}
                {view.detail && <p className="mt-3 text-sm leading-relaxed text-slate-400">{view.detail}</p>}
                {status.canRespondOffer && <OfferActions disabled={busy} />}
                {status.canReportOnTheWay && <OnTheWayButton disabled={busy} />}
                {status.canCancel && (
                  <CancelButton approved={r.status === 'approved'} disabled={busy} />
                )}
              </div>
            )}

            {status.apply && (
              <ApplyBlock
                sundayDate={status.sundayDate}
                apply={status.apply}
                hasCancelledCard={r !== null}
              />
            )}
          </>
        )}
      </section>

      <p className="mt-auto pt-8 text-center text-xs text-slate-600">
        如有停車需求或異動，請聯繫教會停車同工
      </p>
    </main>
  )
}

// Substitution-offer response (Slice 4): confirm is one tap (it secures the spot);
// decline arms first (it gives the spot to the next candidate — irreversible).
function OfferActions({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [arming, setArming] = useState(false)
  const [submitting, setSubmitting] = useState<'confirm' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(action: 'confirm' | 'decline') {
    setSubmitting(action)
    setError(null)
    try {
      const res = await fetch('/api/member/reservation/offer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await res.json()) as { ok: boolean; reason?: string }
      if (res.ok && body.ok) {
        router.refresh()
        return
      }
      setError(
        body.reason === 'offer_expired'
          ? '回覆期限已過，車位已釋出給下一位候補'
          : '目前沒有待回覆的遞補，請重新整理',
      )
      setArming(false)
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="mt-5 space-y-2">
      {arming ? (
        <>
          <p className="text-sm text-amber-400">確定放棄？車位將轉給下一位候補</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respond('decline')}
              disabled={submitting !== null || disabled}
              className="h-12 flex-1 rounded-xl bg-rose-600 text-base font-medium text-white active:bg-rose-500 disabled:opacity-50"
            >
              {submitting === 'decline' ? '送出中…' : '確定放棄'}
            </button>
            <button
              type="button"
              onClick={() => setArming(false)}
              disabled={submitting !== null}
              className="h-12 flex-1 rounded-xl bg-slate-800 text-base text-slate-100 active:bg-slate-700 disabled:opacity-50"
            >
              返回
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => respond('confirm')}
            disabled={submitting !== null || disabled}
            className="h-12 w-full rounded-xl bg-sky-600 text-base font-medium text-white active:bg-sky-500 disabled:opacity-50"
          >
            {submitting === 'confirm' ? '確認中…' : '確認保留車位'}
          </button>
          <button
            type="button"
            onClick={() => setArming(true)}
            disabled={submitting !== null || disabled}
            className="h-12 w-full rounded-xl border border-slate-700 text-base text-slate-300 active:bg-slate-800 disabled:opacity-50"
          >
            放棄這個車位
          </button>
        </>
      )}
      {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
    </div>
  )
}

// P2 「正在路上」(Slice 4): one tap extends the 10:45 deadline to the 10:55 grace.
function OnTheWayButton({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function report() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/member/reservation/on-the-way', { method: 'POST' })
      const body = (await res.json()) as { ok: boolean }
      if (res.ok && body.ok) {
        router.refresh()
        return
      }
      setError('目前無法回報（可能已過期限），請重新整理')
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={report}
        disabled={submitting || disabled}
        className="h-12 w-full rounded-xl bg-amber-600 text-base font-medium text-white active:bg-amber-500 disabled:opacity-50"
      >
        {submitting ? '回報中…' : '我正在路上（保留至 10:55）'}
      </button>
      {error && <p className="mt-2 text-sm text-rose-400" role="alert">{error}</p>}
    </div>
  )
}

// Two-step cancel: first tap arms, second tap fires (same posture as the staff
// page's undo-window — no accidental releases from a pocket tap).
function CancelButton({ approved, disabled }: { approved: boolean; disabled: boolean }) {
  const router = useRouter()
  const [arming, setArming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doCancel() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/member/reservation/cancel', { method: 'POST' })
      const body = (await res.json()) as { ok: boolean; reason?: string }
      if (res.ok && body.ok) {
        router.refresh()
        return
      }
      setError(
        body.reason === 'offer_in_progress'
          ? '目前為遞補確認中，暫無法取消'
          : body.reason === 'nothing_to_cancel'
            ? '本週沒有可取消的登記，請重新整理'
            : '目前無法取消，請聯繫同工',
      )
      setArming(false)
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-5">
      {arming ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-400">
            {approved ? '確定取消？車位將釋出給候補會友' : '確定取消本週登記？'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doCancel}
              disabled={submitting || disabled}
              className="h-12 flex-1 rounded-xl bg-rose-600 text-base font-medium text-white active:bg-rose-500 disabled:opacity-50"
            >
              {submitting ? '取消中…' : '確定取消'}
            </button>
            <button
              type="button"
              onClick={() => setArming(false)}
              disabled={submitting}
              className="h-12 flex-1 rounded-xl bg-slate-800 text-base text-slate-100 active:bg-slate-700 disabled:opacity-50"
            >
              返回
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArming(true)}
          disabled={disabled}
          className="h-12 w-full rounded-xl border border-slate-700 text-base text-slate-300 active:bg-slate-800 disabled:opacity-50"
        >
          取消本週登記
        </button>
      )}
      {error && <p className="mt-2 text-sm text-rose-400" role="alert">{error}</p>}
    </div>
  )
}

function ApplyBlock({
  sundayDate,
  apply,
  hasCancelledCard,
}: {
  sundayDate: string
  apply: NonNullable<MemberWeekStatus['apply']>
  hasCancelledCard: boolean
}) {
  const router = useRouter()
  const [vehicleId, setVehicleId] = useState(apply.vehicles[0]?.id ?? '')
  const [companion, setCompanion] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (apply.staffP1) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
        <p className="text-base text-slate-300">全職同工車位由每週保留名額管理，無需登記</p>
      </div>
    )
  }
  if (apply.closed) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
        <p className="text-lg">本週登記已截止</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          週五分配已完成；主日若臨時需要車位，請至現場洽停車同工
        </p>
      </div>
    )
  }
  if (apply.vehicles.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
        <p className="text-base text-slate-300">尚未登記車輛資料</p>
        <p className="mt-2 text-sm text-slate-400">請聯繫停車同工登記您的車牌後再使用線上登記</p>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || vehicleId === '') return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/member/reservation/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleId, requestedP2: companion }),
      })
      const body = (await res.json()) as { ok: boolean; reason?: string }
      if (res.ok && body.ok) {
        router.refresh()
        return
      }
      setError(APPLY_ERROR_COPY[body.reason ?? ''] ?? '登記失敗，請稍後再試')
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <p className="text-sm text-slate-400">{sundayLabel(sundayDate)}</p>
      <p className="mt-2 text-lg">{hasCancelledCard ? '重新登記本週停車' : '登記本週停車'}</p>

      <label className="mt-4 block text-sm text-slate-400" htmlFor="apply-vehicle">車輛</label>
      <select
        id="apply-vehicle"
        value={vehicleId}
        onChange={e => setVehicleId(e.target.value)}
        className="mt-1 h-12 w-full rounded-xl bg-slate-800 px-4 text-base text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
      >
        {apply.vehicles.map(v => (
          <option key={v.id} value={v.id}>
            {v.plate}
            {v.nickname ? `（${v.nickname}）` : ''}
          </option>
        ))}
      </select>

      {apply.companionKind && (
        <label className="mt-4 flex min-h-12 items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={companion}
            onChange={e => setCompanion(e.target.checked)}
            className="h-5 w-5 accent-sky-500"
          />
          本週有{apply.companionKind === 'elderly' ? '年長者' : '學齡前幼兒'}同行
        </label>
      )}

      <p className="mt-3 h-5 text-sm text-rose-400" role="alert">{error ?? ''}</p>

      <button
        type="submit"
        disabled={submitting}
        className="h-12 w-full rounded-xl bg-sky-600 text-base font-medium text-white active:bg-sky-500 disabled:opacity-50"
      >
        {submitting ? '送出中…' : '送出登記'}
      </button>
    </form>
  )
}
