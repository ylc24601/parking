import { describe, expect, it } from 'vitest'
import { normalizePlate, highlightPlateMatch } from '@/lib/plate'

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumeric characters', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234')
    expect(normalizePlate('ABC 1234')).toBe('ABC1234')
  })
})

describe('highlightPlateMatch', () => {
  it('highlights a pure-digit match with no separators', () => {
    expect(highlightPlateMatch('ABC1234', '1234')).toEqual({
      before: 'ABC',
      match: '1234',
      after: '',
    })
  })

  it('maps a match spanning the hyphen boundary back to raw indices', () => {
    // normalized 'ABC1234', query '1234' -> normalized start=3; raw index 3 is '-',
    // so a naive index-into-raw-string would wrongly start the highlight at '-1234'.
    expect(highlightPlateMatch('ABC-1234', '1234')).toEqual({
      before: 'ABC-',
      match: '1234',
      after: '',
    })
  })

  it('maps a match that starts before the hyphen', () => {
    expect(highlightPlateMatch('DEA-7611', '76')).toEqual({
      before: 'DEA-',
      match: '76',
      after: '11',
    })
  })

  it('maps a match that straddles the hyphen', () => {
    // normalized 'EAB1762', query '176' matches normalized index 3-5 ('176'),
    // which in the raw string is '1' (before hyphen) + '76' (after hyphen).
    expect(highlightPlateMatch('EAB-1762', '176')).toEqual({
      before: 'EAB-',
      match: '176',
      after: '2',
    })
  })

  it('is case-insensitive on both plate and query', () => {
    expect(highlightPlateMatch('abc-1234', 'AB')).toEqual({
      before: '',
      match: 'ab',
      after: 'c-1234',
    })
  })

  it('returns no match when the query is not found', () => {
    expect(highlightPlateMatch('ABC-1234', '999')).toEqual({
      before: 'ABC-1234',
      match: '',
      after: '',
    })
  })

  it('returns no match for an empty query', () => {
    expect(highlightPlateMatch('ABC-1234', '')).toEqual({
      before: 'ABC-1234',
      match: '',
      after: '',
    })
  })
})
