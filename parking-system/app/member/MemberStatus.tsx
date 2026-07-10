'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Member-safe week status DTO, built by the server page from repo rows. Own data
// only — no penalty, no other members, no ids. Dates are ISO strings (client
// formats them in Asia/Taipei).
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

// 狀態 → 會友文案。申請/取消/確認動作在後續切片；本頁唯讀。
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
          ? `已為您保留車位，請於 ${timeLabel(r.offerExpiresAt)} 前確認（確認功能即將開放，可先聯繫同工）`
          : null,
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

export default function MemberStatus({ status }: { status: MemberWeekStatus }) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    setLoggingOut(true)
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
          disabled={loggingOut}
          className="h-12 shrink-0 rounded-xl px-4 text-sm text-slate-400 active:bg-slate-800 disabled:opacity-50"
        >
          登出
        </button>
      </header>

      <section className="mt-8">
        {status.sundayDate === null ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="text-lg">本週登記尚未開放</p>
            <p className="mt-2 text-sm text-slate-400">開放後可在此查看您的停車預約</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm text-slate-400">{sundayLabel(status.sundayDate)}</p>
            {r && view ? (
              <>
                <p
                  className={`mt-3 inline-block rounded-full border px-4 py-1.5 text-base font-medium ${TONE_CLASSES[view.tone]}`}
                >
                  {view.label}
                </p>
                {r.plate && <p className="mt-4 text-2xl font-semibold tracking-wide">{r.plate}</p>}
                {view.detail && <p className="mt-3 text-sm leading-relaxed text-slate-400">{view.detail}</p>}
              </>
            ) : (
              <>
                <p className="mt-3 text-lg">本週尚未登記停車</p>
                <p className="mt-2 text-sm text-slate-400">
                  線上登記功能即將開放；目前請依教會現行方式報名
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <p className="mt-auto pt-8 text-center text-xs text-slate-600">
        如有停車需求或異動，請聯繫教會停車同工
      </p>
    </main>
  )
}
