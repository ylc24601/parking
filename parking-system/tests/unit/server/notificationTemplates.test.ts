import { describe, expect, it } from 'vitest'
import { renderTemplate } from '@/server/services/notification/templates'

// Rendering reads ONLY the payload persisted on the row. Each enqueued key must render a
// non-empty, church-tone line; an unknown key throws so the dispatcher fails that one row.
describe('renderTemplate', () => {
  it('renders every currently-enqueued template key with a non-empty【教會停車】line', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['reservation_approved', {}],
      ['reservation_approved', { direct: true }],
      ['reservation_waiting', { rank: 3 }],
      ['reservation_waiting', {}],
      ['offer_2hr_confirm', { expires_at: '2026-06-20T02:00:00Z' }],
      ['offer_2hr_confirm', {}],
      ['offer_auto_approved', {}],
      ['broadcast_release', { released_count: 2 }],
      ['reservation_released', { released_at: '2026-06-21T02:45:00Z' }],
      ['reservation_cancelled', { cancel_status: 'cancelled_late' }],
      ['reservation_cancelled', { cancel_status: 'cancelled_by_user' }],
      ['p2_arrival_reminder', { sunday_date: '2026-06-21' }],
    ]
    for (const [key, payload] of cases) {
      const text = renderTemplate(key, payload)
      expect(text).toContain('【教會停車】')
      expect(text.length).toBeGreaterThan(10)
    }
  })

  it('includes the waiting rank when provided', () => {
    expect(renderTemplate('reservation_waiting', { rank: 7 })).toContain('第 7 位')
  })

  it('formats the offer expiry as an Asia/Taipei HH:MM', () => {
    // 02:00Z == 10:00 Taipei
    expect(renderTemplate('offer_2hr_confirm', { expires_at: '2026-06-20T02:00:00Z' })).toContain('10:00')
  })

  it('falls back to a generic offer window when expires_at is missing/invalid', () => {
    expect(renderTemplate('offer_2hr_confirm', { expires_at: 'not-a-date' })).toContain('2 小時內')
  })

  it('includes the Sunday label in the P2 reminder', () => {
    expect(renderTemplate('p2_arrival_reminder', { sunday_date: '2026-06-21' })).toContain('2026-06-21')
  })

  it('renders move_car_request with the plate', () => {
    const text = renderTemplate('move_car_request', { license_plate: 'ABC-1234' })
    expect(text).toContain('【教會停車】')
    expect(text).toContain('ABC-1234')
    expect(text).toContain('移車')
  })

  it('renders move_car_request with a fallback when the plate is missing', () => {
    expect(renderTemplate('move_car_request', {})).toContain('車牌未提供')
  })

  it('renders reservation_released with the release time (Asia/Taipei HH:MM), framed as 釋出 not a deadline', () => {
    // 02:45Z == 10:45 Taipei
    const text = renderTemplate('reservation_released', { released_at: '2026-06-21T02:45:00Z' })
    expect(text).toContain('【教會停車】')
    expect(text).toContain('10:45')
    expect(text).toContain('釋出')
    expect(text).toContain('洽詢停車同工')
    // must not reprimand / leak, and must not promise on-site spots exist
    expect(text).not.toMatch(/罰|penalty|逾時|遲到/)
    expect(text).not.toContain('尚有名額')
  })

  it('renders reservation_released with a graceful fallback when released_at is missing/invalid', () => {
    const text = renderTemplate('reservation_released', {})
    expect(text).toContain('【教會停車】')
    expect(text).toContain('釋出')
    expect(renderTemplate('reservation_released', { released_at: 'not-a-date' })).toContain('釋出')
  })

  it('renders reservation_cancelled with distinct wording per cancel_status, and a neutral fallback', () => {
    const late = renderTemplate('reservation_cancelled', { cancel_status: 'cancelled_late' })
    const byUser = renderTemplate('reservation_cancelled', { cancel_status: 'cancelled_by_user' })
    expect(late).toContain('【教會停車】')
    expect(late).toContain('已核准')          // gave up an approved seat
    expect(late).toContain('釋出給候補')
    expect(byUser).toContain('申請／候補')      // was pending/waiting
    expect(late).not.toBe(byUser)
    // unknown / missing status → the neutral (cancelled_by_user) line, never a throw or wrong wording
    expect(renderTemplate('reservation_cancelled', {})).toBe(byUser)
    expect(renderTemplate('reservation_cancelled', { cancel_status: 'weird' })).toBe(byUser)
    // no penalty / personal data in either line
    for (const t of [late, byUser]) expect(t).not.toMatch(/罰|penalty|逾期|名字|車牌/)
  })

  // triage #25: the LINE webhook is capture-only and drops replies, so a "回覆…" instruction
  // is a dead command. Both action templates must route the member to the member page instead
  // (the offer-confirm / on-the-way buttons live there). Forbid ANY 回覆 wording so future
  // rewrites can't silently reintroduce a dead reply command (covers the tail too).
  it.each([
    ['offer_2hr_confirm', { expires_at: '2026-06-20T02:00:00Z' }, '確認保留車位'],
    ['p2_arrival_reminder', { sunday_date: '2026-06-21' }, '我正在路上'],
  ] as const)('%s directs members to the member page instead of replying', (key, payload, action) => {
    const text = renderTemplate(key, payload)
    expect(text).not.toContain('回覆')
    expect(text).toContain('會員頁面')
    expect(text).toContain(action)
  })

  it('throws on an unknown template_key', () => {
    expect(() => renderTemplate('totally_unknown_key', {})).toThrow(/unknown template_key/)
  })
})
