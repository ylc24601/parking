import { describe, expect, it } from 'vitest'
import {
  collectDependents,
  computeEligibility,
  isPregnancy,
  normalizePhone,
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
    expect(validateRow({ applicant_name: 'x', mobile_phone: '1', license_plate: 'A', reason_type: '9' } as RawRow).errors).toContain('invalid reason_type "9"')
    expect(validateRow({ applicant_name: 'x', mobile_phone: '1', license_plate: 'A', reason_type: '1' } as RawRow).errors).toContain('reason_type 1/2 requires impaired_person_name')
    expect(validateRow({ applicant_name: 'x', mobile_phone: '1', license_plate: 'A', reason_type: '3' } as RawRow).errors).toContain('reason_type 3 requires child_1_name or a pregnancy remark')
  })
})
