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

  it('throws on an unknown template_key', () => {
    expect(() => renderTemplate('totally_unknown_key', {})).toThrow(/unknown template_key/)
  })
})
