import { describe, expect, it } from 'vitest'
import {
  collectDependents,
  computeEligibility,
  CsvImportError,
  isPregnancy,
  isValidTaiwanMobilePhone,
  longestCell,
  MAX_ROWS,
  normalizePhone,
  parseCsv,
  parseFormDate,
  validateRow,
  type RawRow,
} from '@/lib/memberImport'

const NOW = new Date('2026-07-06T00:00:00Z')

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('0912-345 678')).toBe('0912345678')
    expect(normalizePhone(null)).toBe('')
  })
})

describe('isValidTaiwanMobilePhone', () => {
  it('accepts 09 + 8 digits (on the normalized form)', () => {
    expect(isValidTaiwanMobilePhone(normalizePhone('0912345678'))).toBe(true)
    expect(isValidTaiwanMobilePhone(normalizePhone('0912-345-678'))).toBe(true)
    expect(isValidTaiwanMobilePhone('0955000001')).toBe(true) // fixture range
  })
  it('rejects junk, landline-style, and empty', () => {
    expect(isValidTaiwanMobilePhone('1')).toBe(false)
    expect(isValidTaiwanMobilePhone('123456789')).toBe(false)      // 9 digits, no leading 09
    expect(isValidTaiwanMobilePhone('0223456789')).toBe(false)     // landline-style (02…)
    expect(isValidTaiwanMobilePhone('09123456789')).toBe(false)    // too long
    expect(isValidTaiwanMobilePhone('')).toBe(false)
  })
})

describe('parseFormDate', () => {
  it('accepts YYYY-MM-DD and YYYY/MM/DD → ISO', () => {
    expect(parseFormDate('2026-01-05')).toBe('2026-01-05')
    expect(parseFormDate('2022/3/1')).toBe('2022-03-01')
  })
  it('rejects junk', () => {
    expect(parseFormDate('')).toBeNull()
    expect(parseFormDate('2026/13/40')).toBeNull()
    expect(parseFormDate('nope')).toBeNull()
  })
})

describe('isPregnancy', () => {
  it('detects 懷孕 / pregnant', () => {
    expect(isPregnancy('懷孕')).toBe(true)
    expect(isPregnancy('Pregnant passenger')).toBe(true)
    expect(isPregnancy('一般')).toBe(false)
  })
})

describe('computeEligibility', () => {
  it('mobility_long / elderly are permanent', () => {
    expect(computeEligibility({ reasonType: 1, now: NOW })).toMatchObject({ p2_reason: 'mobility_long', valid_until: null, review_date: null, reviewRequired: false })
    expect(computeEligibility({ reasonType: 4, now: NOW })).toMatchObject({ p2_reason: 'elderly_companion', valid_until: null, reviewRequired: false })
  })

  it('mobility_short = application_date + 6 months', () => {
    expect(computeEligibility({ reasonType: 2, applicationDate: '2026-02-10', now: NOW }))
      .toMatchObject({ p2_reason: 'mobility_short', valid_until: '2026-08-10', review_date: '2026-08-10', reviewRequired: false })
  })

  it('pregnancy (reason 3 + remark, no children) = application_date + 6 months', () => {
    expect(computeEligibility({ reasonType: 3, remarks: '懷孕', applicationDate: '2026-05-01', now: NOW }))
      .toMatchObject({ p2_reason: 'pregnancy', valid_until: '2026-11-01', reviewRequired: false })
  })

  it('child_companion = max(child birthdate) + 5 years', () => {
    expect(computeEligibility({ reasonType: 3, childBirthdates: ['2022-03-01', '2024-08-15'], now: NOW }))
      .toMatchObject({ p2_reason: 'child_companion', valid_until: '2029-08-15', reviewRequired: false })
  })

  it('reason 3 with children wins over a pregnancy remark', () => {
    expect(computeEligibility({ reasonType: 3, remarks: '懷孕', childBirthdates: ['2023-01-01'], now: NOW }).p2_reason)
      .toBe('child_companion')
  })

  it('missing date → review_required (valid_until null, review_date = today)', () => {
    expect(computeEligibility({ reasonType: 2, applicationDate: null, now: NOW }))
      .toMatchObject({ valid_until: null, review_date: '2026-07-06', reviewRequired: true })
    expect(computeEligibility({ reasonType: 3, childBirthdates: [], now: NOW }))
      .toMatchObject({ p2_reason: 'child_companion', reviewRequired: true })
  })
})

describe('collectDependents', () => {
  it('impaired for reason 1/2', () => {
    expect(collectDependents({ impaired_person_name: '王大明' } as RawRow, 1)).toEqual([{ kind: 'impaired', name: '王大明', birthdate: null }])
  })
  it('elder for reason 4', () => {
    expect(collectDependents({ elder_1_name: '林阿公', elder_1_birthdate: '1945/06/01' } as RawRow, 4))
      .toEqual([{ kind: 'elder', name: '林阿公', birthdate: '1945-06-01' }])
  })
  it('multiple children for reason 3', () => {
    const row = { child_1_name: '張小寶', child_1_birthdate: '2022/03/01', child_2_name: '張小小', child_2_birthdate: '2024/08/15' } as RawRow
    expect(collectDependents(row, 3)).toEqual([
      { kind: 'child', name: '張小寶', birthdate: '2022-03-01' },
      { kind: 'child', name: '張小小', birthdate: '2024-08-15' },
    ])
  })
  it('no dependent for pregnancy-only reason 3', () => {
    expect(collectDependents({ remarks: '懷孕' } as RawRow, 3)).toEqual([])
  })
})

describe('validateRow', () => {
  it('passes a well-formed elderly row', () => {
    const { reasonType, errors } = validateRow({ applicant_name: '林先生', mobile_phone: '0912000003', license_plate: 'GHI-3003', reason_type: '4', elder_1_name: '林阿公', elder_1_birthdate: '1945/06/01' } as RawRow)
    expect(reasonType).toBe(4)
    expect(errors).toEqual([])
  })
  it('flags missing conditional fields and bad reason_type', () => {
    expect(validateRow({ applicant_name: 'x', mobile_phone: '0912345678', license_plate: 'A', reason_type: '9' } as RawRow).errors).toContain('invalid reason_type "9"')
    expect(validateRow({ applicant_name: 'x', mobile_phone: '0912345678', license_plate: 'A', reason_type: '1' } as RawRow).errors).toContain('reason_type 1/2 requires impaired_person_name')
    expect(validateRow({ applicant_name: 'x', mobile_phone: '0912345678', license_plate: 'A', reason_type: '3' } as RawRow).errors).toContain('reason_type 3 requires child_1_name or a pregnancy remark')
  })

  it('flags a missing or malformed mobile_phone (the identity key)', () => {
    const base = { applicant_name: 'x', license_plate: 'A', reason_type: '4', elder_1_name: 'e', elder_1_birthdate: '1945/01/01' }
    expect(validateRow({ ...base, mobile_phone: '' } as RawRow).errors).toContain('missing mobile_phone')
    expect(validateRow({ ...base, mobile_phone: '1' } as RawRow).errors.some(e => e.startsWith('invalid mobile_phone'))).toBe(true)
    expect(validateRow({ ...base, mobile_phone: '123456789' } as RawRow).errors.some(e => e.startsWith('invalid mobile_phone'))).toBe(true)
    // a valid mobile passes (no phone error)
    expect(validateRow({ ...base, mobile_phone: '0912-345-678' } as RawRow).errors).toEqual([])
  })
})

describe('parseCsv — structure + limits', () => {
  const HEADER = 'applicant_name,mobile_phone,license_plate,reason_type'
  const goodRow = '王小明,0912345678,ABC-1234,1'

  it('parses header-keyed rows (BOM tolerated)', () => {
    const rows = parseCsv(`﻿${HEADER}\n${goodRow}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ applicant_name: '王小明', mobile_phone: '0912345678', reason_type: '1' })
  })

  it('header-only or empty-ish input → zero rows (not an error)', () => {
    expect(parseCsv(HEADER)).toEqual([])
  })

  it('tolerates CRLF, quoted commas, and quoted newlines', () => {
    const rows = parseCsv(`${HEADER},remarks\r\n王,0912345678,"AB,CD",1,"line1\nline2"\r\n`)
    expect(rows).toHaveLength(1)
    expect(rows[0].license_plate).toBe('AB,CD')
    expect(rows[0].remarks).toBe('line1\nline2')
  })

  it('missing a required header → missing_headers', () => {
    expect(() => parseCsv('applicant_name,mobile_phone,license_plate\n王,0912345678,A')).toThrowError(
      expect.objectContaining({ code: 'missing_headers' }),
    )
  })

  it('duplicate headers → duplicate_headers', () => {
    expect(() => parseCsv(`${HEADER},mobile_phone\n${goodRow},0911111111`)).toThrowError(
      expect.objectContaining({ code: 'duplicate_headers' }),
    )
  })

  it('malformed quoting → invalid_csv (parser message not surfaced)', () => {
    let thrown: unknown
    try { parseCsv(`${HEADER}\n"unterminated,0912345678,A,1`) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(CsvImportError)
    expect((thrown as CsvImportError).code).toBe('invalid_csv')
  })

  it('more than MAX_ROWS data rows → too_many_rows', () => {
    const body = Array.from({ length: MAX_ROWS + 1 }, () => goodRow).join('\n')
    expect(() => parseCsv(`${HEADER}\n${body}`)).toThrowError(
      expect.objectContaining({ code: 'too_many_rows' }),
    )
  })

  it('exactly MAX_ROWS rows is allowed', () => {
    const body = Array.from({ length: MAX_ROWS }, () => goodRow).join('\n')
    expect(parseCsv(`${HEADER}\n${body}`)).toHaveLength(MAX_ROWS)
  })
})

describe('longestCell', () => {
  it('returns the max cell length by code points', () => {
    expect(longestCell({ a: 'xy', b: '王小明' } as RawRow)).toBe(3)
    expect(longestCell({ a: '', b: undefined as unknown as string } as RawRow)).toBe(0)
  })
})
