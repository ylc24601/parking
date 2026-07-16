import { describe, expect, it, vi } from 'vitest'
import { importMembersFromCsvText } from '@/server/services/memberImportService'
import type { ParkingRepository } from '@/server/repositories/parkingRepository'

// Wave 0 (#20/#21/#22) — the service pipeline over a mock repo: profile branch (roster P1/P3 →
// reason=null, P2 → canonical reason), group consistency, row-completeness, batch-local plate
// preflight, and the p2Retained warning. importMembersFromCsvText only ever calls repo.importMember.

type ImportArgs = Parameters<ParkingRepository['importMember']>[0]

function mockRepo(override?: ParkingRepository['importMember']): { repo: ParkingRepository; calls: ImportArgs[] } {
  const calls: ImportArgs[] = []
  const importMember: ParkingRepository['importMember'] =
    override ??
    (async (args: ImportArgs) => {
      calls.push(args)
      return { status: 'imported', vehicles_added: args.plates.length, dependents_added: 0, plate_conflicts: [] }
    })
  return { repo: { importMember } as unknown as ParkingRepository, calls }
}

const NOW = new Date('2026-07-16T20:00:00Z') // 2026-07-17 Taipei

describe('importMembersFromCsvText — profiles', () => {
  it('roster: P3 and P1 pass reason=null (no eligibility); P2 passes a canonical reason', async () => {
    const csv = [
      '姓名,手機,車牌,優先序,P2事由',
      '甲,0912345678,AAA1111,P3,',
      '乙,0922333444,BBB2222,P2,長者同行',
      '丙,0933555777,CCC3333,P1,',
    ].join('\n')
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: false, now: NOW }, repo)
    expect(report.imported).toBe(3)
    const byPhone = Object.fromEntries(calls.map(c => [c.phone, c]))
    expect(byPhone['0912345678'].reason).toBeNull() // P3
    expect(byPhone['0933555777'].reason).toBeNull() // P1
    expect(byPhone['0922333444'].reason).toBe('elderly_companion') // P2
  })

  it('roster P2 with a windowed reason is review-required', async () => {
    const csv = '姓名,手機,車牌,優先序,P2事由\n甲,0912345678,AAA1111,P2,孕婦'
    const { repo } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(report.reviewRequired).toEqual([{ phone: '0912345678', reason: 'pregnancy' }])
  })

  it('p2_application coexists: numeric 申請原因 + eligibility computed', async () => {
    const csv = '申請日期,申請人姓名,車牌號碼,手機號碼,申請原因,長者姓名,長者生日\n2026-01-05,林,DEF5678,0912345678,4,林母,1945/06/01'
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(report.imported).toBe(1)
    expect(calls[0].reason).toBe('elderly_companion')
  })

  it('9-digit phone is restored to the canonical key and used for grouping', async () => {
    const csv = '姓名,手機,車牌,優先序\n甲,912345678,AAA1111,P3\n甲,912345678,BBB2222,P3'
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(report.members).toBe(1) // grouped on the restored 0912345678
    expect(calls[0].phone).toBe('0912345678')
    expect([...calls[0].plates].sort()).toEqual(['AAA1111', 'BBB2222'])
  })

  it('batch-local plate conflict: same plate, two phones → both skipped, reported separately', async () => {
    const csv = '姓名,手機,車牌,優先序\n甲,0912345678,SAME1,P3\n乙,0922333444,SAME1,P3'
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(calls).toHaveLength(0) // neither imported (fail closed)
    expect(report.imported).toBe(0)
    expect(report.batchPlateConflicts).toHaveLength(1)
    expect(report.batchPlateConflicts[0].plate).toBe('SAME1')
    expect([...report.batchPlateConflicts[0].phones].sort()).toEqual(['0912345678', '0922333444'])
    expect(report.plateConflicts).toHaveLength(0) // distinct from the DB-conflict list
  })

  it('same phone with inconsistent priority → whole member skipped (priorityConflicts)', async () => {
    const csv = '姓名,手機,車牌,優先序,P2事由\n甲,0912345678,AAA1111,P2,長者同行\n甲,0912345678,BBB2222,P3,'
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(calls).toHaveLength(0)
    expect(report.priorityConflicts).toHaveLength(1)
    expect([...report.priorityConflicts[0].priorities].sort()).toEqual(['P2', 'P3'])
  })

  it('row-completeness: one valid + one invalid row for a phone → whole member skipped', async () => {
    const csv = '姓名,手機,車牌,優先序,P2事由\n甲,0912345678,AAA1111,P2,長者同行\n甲,0912345678,BBB2222,P2,亂寫'
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(calls).toHaveLength(0) // never silently import only the valid row
    expect(report.validationErrors.length).toBeGreaterThanOrEqual(1)
  })

  it('row-completeness also holds for an over-long-cell row (every reject path taints the member)', async () => {
    const long = 'x'.repeat(600) // > MAX_CELL_CODEPOINTS
    const csv = `姓名,手機,車牌,優先序,備註\n甲,0912345678,AAA1111,P3,ok\n甲,0912345678,BBB2222,P3,${long}`
    const { repo, calls } = mockRepo()
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: true, now: NOW }, repo)
    expect(calls).toHaveLength(0) // the valid row must NOT import on its own
    expect(report.validationErrors.length).toBeGreaterThanOrEqual(1)
  })

  it('roster P1/P3 landing on an existing P2 member surfaces p2Retained (not revoked)', async () => {
    const csv = '姓名,手機,車牌,優先序\n甲,0912345678,AAA1111,P3'
    const { repo } = mockRepo(vi.fn(async () => ({
      status: 'updated' as const, vehicles_added: 0, dependents_added: 0, plate_conflicts: [], retained_p2: true,
    })))
    const report = await importMembersFromCsvText({ csvText: csv, dryRun: false, now: NOW }, repo)
    expect(report.p2Retained).toEqual([{ phone: '0912345678' }])
    expect(report.updated).toBe(1)
  })
})
