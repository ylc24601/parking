import { describe, expect, it } from 'vitest'
import { computeReleaseDeadline, releaseExpired } from '@/lib/allocation/release'
import { makeReservation, makeWalkIn, T } from './helpers'

// P3 reservation: deadline 10:30
const p3 = (overrides = {}) =>
  makeReservation({ effective_priority: 3, release_deadline_at: T.SUN_1030, ...overrides })
// P2 reservation: deadline 10:45
const p2 = (overrides = {}) =>
  makeReservation({ effective_priority: 2, release_deadline_at: T.SUN_1045, ...overrides })
// P2 on-the-way: deadline 10:55
const p2OnWay = (overrides = {}) =>
  makeReservation({
    effective_priority: 2,
    p2_on_the_way: true,
    release_deadline_at: T.SUN_1055,
    ...overrides,
  })

describe('releaseExpired', () => {
  // ── P3 @ 10:30 ─────────────────────────────────────────────────────────────
  it('P3 approved: not released before 10:30', () => {
    const { reservations, releasedCount } = releaseExpired([p3({ status: 'approved' })], T.SUN_1000)
    expect(reservations[0].status).toBe('approved')
    expect(releasedCount).toBe(0)
  })

  it('P3 approved → released_late at 10:30', () => {
    const { reservations } = releaseExpired([p3({ status: 'approved' })], T.SUN_1030)
    expect(reservations[0].status).toBe('released_late')
  })

  it('P3 approved → released_late after 10:30, sets released_at', () => {
    const { reservations } = releaseExpired([p3({ status: 'approved' })], T.SUN_1031)
    expect(reservations[0].status).toBe('released_late')
    expect(reservations[0].released_at?.getTime()).toBe(T.SUN_1031.getTime())
  })

  // ── P2 @ 10:45 ─────────────────────────────────────────────────────────────
  it('P2 approved: NOT released at 10:30 (held until 10:45)', () => {
    const { reservations, releasedCount } = releaseExpired([p2({ status: 'approved' })], T.SUN_1030)
    expect(reservations[0].status).toBe('approved')
    expect(releasedCount).toBe(0)
  })

  it('P2 approved (not on the way) → released_late at 10:45', () => {
    const { reservations } = releaseExpired([p2({ status: 'approved' })], T.SUN_1045)
    expect(reservations[0].status).toBe('released_late')
  })

  // ── P2 on the way @ 10:55 ────────────────────────────────────────────────────
  it('P2 on the way: NOT released at 10:45 (held until 10:55)', () => {
    const { reservations, releasedCount } = releaseExpired([p2OnWay({ status: 'approved' })], T.SUN_1045)
    expect(reservations[0].status).toBe('approved')
    expect(releasedCount).toBe(0)
  })

  it('P2 on the way → released_late at 10:55', () => {
    const { reservations } = releaseExpired([p2OnWay({ status: 'approved' })], T.SUN_1055)
    expect(reservations[0].status).toBe('released_late')
  })

  // ── Status guards ────────────────────────────────────────────────────────────
  it('does not change attended reservations', () => {
    const { reservations } = releaseExpired([p3({ status: 'attended' })], T.SUN_1031)
    expect(reservations[0].status).toBe('attended')
  })

  it('does not downgrade an approved-but-already-attended record (attended_at set)', () => {
    // Defensive: status approved yet attended_at populated → must not be released.
    const res = p3({ status: 'approved', attended_at: T.SUN_1000 })
    const { reservations } = releaseExpired([res], T.SUN_1031)
    expect(reservations[0].status).toBe('approved')
  })

  it('does not change waiting reservations', () => {
    const { reservations } = releaseExpired([p3({ status: 'waiting' })], T.SUN_1031)
    expect(reservations[0].status).toBe('waiting')
  })

  it('does not change cancelled_late reservations', () => {
    const { reservations } = releaseExpired([p3({ status: 'cancelled_late' })], T.SUN_1031)
    expect(reservations[0].status).toBe('cancelled_late')
  })

  it('does not change cancelled_by_user reservations', () => {
    const { reservations } = releaseExpired([p3({ status: 'cancelled_by_user' })], T.SUN_1031)
    expect(reservations[0].status).toBe('cancelled_by_user')
  })

  it('does not touch temp_approved during release', () => {
    const { reservations } = releaseExpired([p3({ status: 'temp_approved' })], T.SUN_1031)
    expect(reservations[0].status).toBe('temp_approved')
  })

  it('does not touch walk_in reservations', () => {
    const { reservations } = releaseExpired([makeWalkIn()], T.SUN_1031)
    expect(reservations[0].status).toBe('walk_in')
  })

  // ── Mixed batch / counting ───────────────────────────────────────────────────
  it('at 10:45 releases due P3 and P2 but leaves on-the-way P2 held', () => {
    const reservations = [
      p3({ status: 'approved' }),       // due at 10:30
      p2({ status: 'approved' }),       // due at 10:45
      p2OnWay({ status: 'approved' }),  // due at 10:55
    ]
    const { reservations: result, releasedCount } = releaseExpired(reservations, T.SUN_1045)
    expect(releasedCount).toBe(2)
    expect(result[2].status).toBe('approved')
  })

  // ── Broadcast ─────────────────────────────────────────────────────────────────
  it('broadcasts to all waiting users when spaces are released', () => {
    const approved = p3({ status: 'approved' })
    const w1 = makeReservation({ status: 'waiting' })
    const w2 = makeReservation({ status: 'waiting' })
    const { outbox } = releaseExpired([approved, w1, w2], T.SUN_1031)

    const broadcasts = outbox.filter(o => o.template_key === 'broadcast_release')
    expect(broadcasts).toHaveLength(2)
    expect(broadcasts.map(o => o.user_id)).toContain(w1.user_id)
    expect(broadcasts.map(o => o.user_id)).toContain(w2.user_id)
  })

  it('emits no broadcast when no spaces were released', () => {
    const { outbox } = releaseExpired(
      [p3({ status: 'attended' }), makeReservation({ status: 'waiting' })],
      T.SUN_1031,
    )
    expect(outbox).toHaveLength(0)
  })

  // ── Idempotency ────────────────────────────────────────────────────────────────
  it('is idempotent: second run releases nothing more', () => {
    const { reservations: firstPass } = releaseExpired([p3({ status: 'approved' })], T.SUN_1031)
    const { releasedCount: secondCount } = releaseExpired(firstPass, T.SUN_1230)
    expect(secondCount).toBe(0)
  })
})

// ── computeReleaseDeadline ──────────────────────────────────────────────────────

describe('computeReleaseDeadline', () => {
  const deadlines = { p3: T.SUN_1030, p2: T.SUN_1045, p2Grace: T.SUN_1055 }

  it('P3 → 10:30', () => {
    expect(computeReleaseDeadline({ effective_priority: 3, p2_on_the_way: false }, deadlines)).toBe(T.SUN_1030)
  })

  it('P2 not on the way → 10:45', () => {
    expect(computeReleaseDeadline({ effective_priority: 2, p2_on_the_way: false }, deadlines)).toBe(T.SUN_1045)
  })

  it('P2 on the way → 10:55', () => {
    expect(computeReleaseDeadline({ effective_priority: 2, p2_on_the_way: true }, deadlines)).toBe(T.SUN_1055)
  })
})
