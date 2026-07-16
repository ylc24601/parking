import type { NotificationTemplate } from '@/lib/types'

// Phase 4 Slice A — render an outbox row's stored template_key + payload_json into the LINE
// message text. Reads ONLY the payload already persisted on the row; never re-reads member /
// penalty / pastoral tables. Church-tone, short, phone-readable (LINE push).
//
// Covers the keys actually enqueued today (allocate / substitute / release / p2 reminder).
// An unknown key throws → the dispatcher marks that one row failed (render_error), it does
// not crash the batch. Settlement deliberately enqueues nothing (pastoral notify deferred).
//
// COPY RULE (triage #25): member-facing templates must NOT ask the member to "回覆" (reply) to
// act — the LINE webhook is capture-only (§6.19) and silently drops replies, so any reply
// instruction is a dead command. Route every member action to the member page instead
// (offer confirm / on-the-way live in app/member/MemberStatus.tsx). A live tappable deep-link
// back to that page is the proper fix (#26); this file only carries the interim text pointer.

type Payload = Record<string, unknown>

function taipeiTime(iso: unknown): string {
  if (typeof iso !== 'string') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

const RENDERERS: Record<NotificationTemplate, (p: Payload) => string> = {
  reservation_approved: () =>
    '【教會停車】您好 🙏 您本週的停車申請已核准，主日見！請於各車位釋出時間前抵達地下室，謝謝您。',

  reservation_waiting: p => {
    const rank = typeof p.rank === 'number' ? p.rank : null
    return rank
      ? `【教會停車】您好 🙏 本週車位已額滿，您目前候補第 ${rank} 位。若有名額釋出我們會再通知您，謝謝您的耐心。`
      : '【教會停車】您好 🙏 本週車位已額滿，您已進入候補名單。若有名額釋出我們會再通知您，謝謝您的耐心。'
  },

  offer_2hr_confirm: p => {
    const at = taipeiTime(p.expires_at)
    const tail = at ? `（請於 ${at} 前確認）` : '（請於 2 小時內確認）'
    return `【教會停車】您好 🙏 有一個停車名額釋出給您！請開啟會員頁面（LINE 選單）點選『確認保留車位』${tail}。逾時未確認將順延給下一位，謝謝您。`
  },

  offer_auto_approved: () =>
    '【教會停車】您好 🙏 有名額釋出，已為您自動保留本週車位。主日見！',

  broadcast_release: () =>
    '【教會停車】您好 🙏 現在有停車名額釋出，歡迎候補的弟兄姊妹前往地下室停車（現場先到先停、不保證保留），謝謝您。',

  // Sunday release sweep: tell the member whose reserved seat was released (missed check-in) —
  // informational, no penalty/reprimand. `released_at` is the RELEASE time (not the deadline);
  // it must not promise on-site spots exist. Provisional copy; final wording is church sign-off.
  reservation_released: p => {
    const at = taipeiTime(p.released_at)
    const when = at ? `已於 ${at} 釋出` : '已釋出'
    return `【教會停車】您好 🙏 您本週保留的車位${when}。若仍需停車，請前往地下室現場洽詢停車同工，將依現場狀況協助，謝謝您。`
  },

  // Member SELF-cancellation confirmation only — the「已為您取消」wording assumes the member acted.
  // Do NOT reuse for an admin/staff-initiated cancellation (different actor → different wording);
  // that would need its own template. Reads only the row's `cancel_status` (authoritative from the
  // apply_cancellation RPC state); any value other than `cancelled_late` uses the neutral line.
  reservation_cancelled: p => {
    if (p.cancel_status === 'cancelled_late') {
      return '【教會停車】您好 🙏 您本週已核准的停車預約已為您取消，車位將釋出給候補的弟兄姊妹。若需重新申請請至報名系統，謝謝您。'
    }
    return '【教會停車】您好 🙏 您本週的停車申請／候補已為您取消。若需重新申請請至報名系統，謝謝您。'
  },

  p2_arrival_reminder: p => {
    const label = typeof p.sunday_date === 'string' ? p.sunday_date : '本主日'
    return `【教會停車】您好 🙏 提醒您 ${label} 的車位保留至 10:45。若您正在路上，請開啟會員頁面點選『我正在路上』，我們會為您保留至 10:55，謝謝您。`
  },

  // Staff-initiated: ask a specific car's owner to move it (OA push, no personal contact shown).
  // Provisional version-A copy (docs/oa-onboarding-and-move-car-copy.md §二 A); final wording is
  // church sign-off. Reads only the plate persisted on the row.
  move_car_request: p => {
    const plate = typeof p.license_plate === 'string' && p.license_plate ? p.license_plate : '（車牌未提供）'
    return `【教會停車】您好 🙏 您停在地下室的車（車牌 ${plate}）需要麻煩您移車，請您方便時盡快到地下室處理，現場有停車同工協助，謝謝您的配合！`
  },

  // Reserved template keys not currently enqueued; render a safe generic line rather than throw.
  staff_reminder: () => '【教會停車】同工提醒：請確認本週現場點名與車位狀況，謝謝您的服事。',
  admin_finalize_reminder: () => '【教會停車】提醒：本週點名尚未結束，請記得於系統執行「結束當週點名」，謝謝。',
}

export function renderTemplate(key: string, payload: Payload): string {
  const render = RENDERERS[key as NotificationTemplate]
  if (!render) throw new Error(`unknown template_key: ${key}`)
  return render(payload ?? {})
}
