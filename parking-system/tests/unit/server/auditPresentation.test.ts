import { describe, expect, it } from 'vitest'
import {
  AUDIT_BOUNDARY_NOTE,
  auditActionLabel,
  renderAuditDetails,
  UNKNOWN_ACTION_DETAIL,
  UNREADABLE_DETAIL,
} from '@/server/services/auditPresentation'

// Wave 2A-2 (#15). This registry is the read-side privacy boundary, not a label
// map: it decides which metadata may be displayed AT ALL. The tests that matter
// here are the ones proving it never renders something it wasn't told to.

describe('auditActionLabel', () => {
  it('labels known actions and falls back to the raw code for unknown ones', () => {
    expect(auditActionLabel('admin_account.disable')).toBe('停用管理員帳號')
    // An unlabelled row must still be identifiable — hiding it, or blanking the
    // action, would read as "nothing happened".
    expect(auditActionLabel('future.action')).toBe('future.action')
  })
})

describe('renderAuditDetails — known action, valid metadata', () => {
  it('renders only what the action declares it reads', () => {
    const r = renderAuditDetails('admin_account.disable', {
      disabled_to: true,
      state_changed: true,
    })
    expect(r.fallback).toBeNull()
    expect(r.unsupportedCount).toBe(0)
    expect(r.details).toEqual([{ label: '帳號狀態', value: '已變更' }])
  })

  it('spells out the repeat-disable case rather than hiding it', () => {
    // state_changed=false is deliberate: 0026:69 revokes sessions unconditionally,
    // so a "no-op" repeat disable is still a real security action. The copy has to
    // say the account did not change AND that sessions were forced out, or the row
    // looks like pointless noise.
    const r = renderAuditDetails('admin_account.disable', {
      disabled_to: true,
      state_changed: false,
    })
    expect(r.details[0].value).toContain('未變更')
    expect(r.details[0].value).toContain('重新登入')
  })

  it('maps a denied reason to operator language, unknown reason falls back to the code', () => {
    expect(renderAuditDetails('admin_account.disable', { reason: 'last_active_admin' }).details)
      .toEqual([{ label: '結果原因', value: '不可停用最後一位系統管理員' }])
    expect(renderAuditDetails('admin_account.disable', { reason: 'future_guard' }).details)
      .toEqual([{ label: '結果原因', value: 'future_guard' }])
  })

  it('renders the bootstrap marker as "the trail starts here"', () => {
    const r = renderAuditDetails('audit.substrate_enabled', {
      schema_version: 2,
      historical_events_backfilled: false,
    })
    expect(r.fallback).toBeNull()
    expect(r.details).toEqual([{ label: '歷史紀錄', value: '未回填（紀錄自此開始）' }])
  })
})

describe('renderAuditDetails — the allowlist holds', () => {
  it('never renders an extra key a future writer added, and counts it instead', () => {
    // The exact hazard this registry exists for: 0030's write-side denylist would
    // pass `eligibility_comment` (that key simply isn't on it), so a generic
    // "render every key" viewer would print a medical note to the page.
    const r = renderAuditDetails('admin_account.disable', {
      disabled_to: true,
      state_changed: true,
      eligibility_comment: '因罹患重大疾病',
      vehicle_identifier: 'ABC-1234',
    })
    const serialized = JSON.stringify(r)
    expect(serialized).not.toContain('因罹患重大疾病')
    expect(serialized).not.toContain('ABC-1234')
    // The key NAMES leak too — 'eligibility_comment' beside a member entity is
    // itself revealing — so only a count escapes.
    expect(serialized).not.toContain('eligibility_comment')
    expect(r.unsupportedCount).toBe(2)
  })

  it('unknown action renders no metadata at all, and no count', () => {
    const r = renderAuditDetails('future.action', {
      review_note_text: '不可外洩',
      whatever: 'secret',
    })
    expect(r.details).toEqual([])
    expect(r.fallback).toBe(UNKNOWN_ACTION_DETAIL)
    expect(JSON.stringify(r)).not.toContain('不可外洩')
    expect(JSON.stringify(r)).not.toContain('secret')
    // A count here would read as「內容因權限不足而被隱藏」— false, and the opposite
    // of what this page is for.
    expect(r.unsupportedCount).toBe(0)
  })
})

describe('AUDIT_BOUNDARY_NOTE must not claim a control that is not running', () => {
  // ⚠️ 2A-3 (retention purge): when the monthly purge ships, THIS TEST FAILS — and
  // that is its job. Delete the qualifier assertion and update the copy to a flat
  // 「紀錄保留 24 個月」then, deliberately. Do not "fix" it by loosening the check.
  it('says automatic cleanup is not enabled yet, because 2A-3 has not shipped', () => {
    // A bare「紀錄保留 24 個月」implies rows older than that are gone. Nothing is
    // deleting anything yet, so that would be a false PRIVACY claim — the kind of
    // promise-without-a-mechanism this project has been bitten by before.
    expect(AUDIT_BOUNDARY_NOTE).toContain('自動清理將於後續維運功能啟用')
  })

  it('tells the reader what the log does NOT cover', () => {
    // Absence of a row is not proof of absence of an action: the substrate makes
    // forging expensive, not omission impossible.
    expect(AUDIT_BOUNDARY_NOTE).toContain('不是完整的操作紀錄')
    // And a staff row is a shared PIN session, never a named person.
    expect(AUDIT_BOUNDARY_NOTE).toContain('無法辨識個人')
  })
})

describe('renderAuditDetails — malformed shapes fail safe, never throw', () => {
  it('a known key of the wrong type reports ONE fault, not two', () => {
    const r = renderAuditDetails('admin_account.disable', { state_changed: { nested: true } })
    expect(r.fallback).toBe(UNREADABLE_DETAIL)
    expect(r.details).toEqual([])
    // No count alongside the fallback: the same single broken field would otherwise
    // show as「格式無法辨識」and「另有 1 項未顯示」at once.
    expect(r.unsupportedCount).toBe(0)
  })

  it.each([
    ['null', null],
    ['a string', 'not-an-object'],
    ['an array', [1, 2]],
    ['a number', 42],
    ['undefined', undefined],
  ])('metadata that is %s falls back instead of throwing', (_label, metadata) => {
    const r = renderAuditDetails('admin_account.disable', metadata)
    expect(r.fallback).toBe(UNREADABLE_DETAIL)
    expect(r.details).toEqual([])
  })

  it('never dumps raw JSON into a fallback', () => {
    const r = renderAuditDetails('admin_account.disable', { state_changed: 'yes-ish', secret: 'x' })
    expect(JSON.stringify(r)).not.toContain('yes-ish')
    expect(JSON.stringify(r)).not.toContain('secret')
  })
})
