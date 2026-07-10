import type { Metadata, Viewport } from 'next'
import { taipeiToday } from '@/lib/taipeiDate'
import { getMemberSession } from '@/server/http/memberAuth'
import { MemberAuthConfigError, resolveMemberAuthMode } from '@/server/services/memberAuthService'
import { createParkingRepository } from '@/server/repositories/parkingRepository'
import MemberLiffGate from './MemberLiffGate'
import MemberStatus, { type MemberWeekStatus } from './MemberStatus'

export const metadata: Metadata = {
  title: '會友專區 · 教會停車',
}

// LIFF is a phone surface: lock layout to device width (same posture as /staff).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
}

// Server component: gate on the member session. Logged out → LIFF/mock login gate.
// Logged in → fetch this week's own reservation server-side and map it to the
// member-safe DTO (never the raw DB row).
export default async function MemberPage() {
  const session = await getMemberSession()

  if (!session) {
    let mode: 'liff' | 'mock'
    try {
      mode = resolveMemberAuthMode().mode
    } catch (e) {
      if (e instanceof MemberAuthConfigError) return <ConfigError code={e.code} />
      throw e
    }
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? null
    if (mode === 'liff' && !liffId) return <ConfigError code="missing_liff_id" />
    return <MemberLiffGate mode={mode} liffId={liffId} />
  }

  const repo = createParkingRepository()
  const [displayName, event] = await Promise.all([
    repo.getUserDisplayName(session.userId),
    repo.getMemberEvent(taipeiToday(new Date())),
  ])
  const reservation = event ? await repo.getMemberWeekReservation(session.userId, event.id) : null

  const status: MemberWeekStatus = {
    displayName: displayName ?? '會友',
    sundayDate: event?.sunday_date ?? null,
    reservation: reservation
      ? {
          status: reservation.status,
          plate: reservation.license_plate,
          releaseDeadlineAt: reservation.release_deadline_at?.toISOString() ?? null,
          offerExpiresAt: reservation.offer_expires_at?.toISOString() ?? null,
          p2OnTheWay: reservation.p2_on_the_way,
        }
      : null,
  }
  return <MemberStatus status={status} />
}

// Deploy-time misconfiguration (bad MEMBER_AUTH_MODE / missing channel or LIFF id).
// Member-facing copy stays generic; the code is operator-diagnosable and secret-free.
function ConfigError({ code }: { code: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-slate-100">
      <h1 className="text-xl font-semibold">會友專區暫時無法使用</h1>
      <p className="text-sm text-slate-400">請聯繫管理同工（{code}）</p>
    </main>
  )
}
