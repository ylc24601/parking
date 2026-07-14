'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

// Member CSV upload: two-step preview → apply. The raw file lives ONLY in a ref (not
// React state) so its full PII contents don't sit in devtools-inspectable state — only
// the operator-facing report + the (non-PII) confirmation token do. Everything is
// cleared on a new file / success. Nothing is persisted to storage/URL/analytics.

const MAX_CSV_BYTES = 2 * 1024 * 1024

interface ImportReport {
  dryRun: boolean
  rows: number
  members: number
  imported: number
  updated: number
  vehiclesAdded: number
  dependentsAdded: number
  phoneNameConflicts: Array<{ phone: string; names: string[]; existingName?: string }>
  plateConflicts: Array<{ phone: string; plates: string[] }>
  reviewRequired: Array<{ phone: string; reason: string }>
  validationErrors: Array<{ line: number; errors: string[] }>
  truncated: boolean
  totals: { phoneNameConflicts: number; plateConflicts: number; reviewRequired: number; validationErrors: number }
}

const REASON_MESSAGE: Record<string, string> = {
  invalid_csv: '無法解析 CSV，請確認格式（引號、逗號）正確',
  missing_headers: '缺少必要欄位表頭（applicant_name / mobile_phone / license_plate / reason_type）',
  duplicate_headers: 'CSV 表頭有重複欄位',
  too_many_rows: '資料列過多（上限 5000 列）',
  invalid_encoding: '檔案編碼不是 UTF-8，請另存為 UTF-8 後再上傳',
  payload_too_large: '檔案過大（上限 2 MB）',
  unsupported_media_type: '檔案類型不正確',
  empty: '檔案是空的',
  preview_mismatch: '檔案內容與預覽不符，請重新預覽後再匯入',
  preview_expired: '預覽已逾時，請重新預覽',
  bad_confirmation: '確認資訊無效，請重新預覽',
}

type Phase = 'idle' | 'previewed' | 'applied' | 'partial'

export default function MemberImport() {
  const fileRef = useRef<File | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processedMembers, setProcessedMembers] = useState<number | null>(null)

  function resetAll() {
    fileRef.current = null
    setFileName(null)
    setReport(null)
    setToken(null)
    setPhase('idle')
    setAcknowledged(false)
    setError(null)
    setProcessedMembers(null)
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    // A new file invalidates any prior preview/token.
    resetAll()
    const file = e.target.files?.[0] ?? null
    if (!file) return
    if (file.size > MAX_CSV_BYTES) {
      setError('檔案過大（上限 2 MB）')
      return
    }
    fileRef.current = file
    setFileName(file.name)
  }

  async function preview() {
    const file = fileRef.current
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const res = await fetch('/api/admin/members/import/preview', {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: bytes,
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setReport(data.report as ImportReport)
        setToken(data.confirmationToken as string)
        setPhase('previewed')
        setAcknowledged(false)
      } else {
        setError(REASON_MESSAGE[data?.reason] ?? '預覽失敗，請再試一次')
      }
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    const file = fileRef.current
    if (!file || !token || busy) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const res = await fetch('/api/admin/members/import/apply', {
        method: 'POST',
        headers: { 'content-type': 'text/csv', 'x-import-confirmation': token },
        body: bytes,
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setReport(data.report as ImportReport)
        setPhase('applied')
        setToken(null)
        fileRef.current = null // written — drop the raw file
      } else if (data?.reason === 'partial_apply') {
        // Some members were written before an error. Keep the file so the operator can
        // re-preview and re-apply (import is idempotent).
        setReport(data.report as ImportReport)
        setProcessedMembers(typeof data.processedMembers === 'number' ? data.processedMembers : null)
        setPhase('partial')
      } else {
        setError(REASON_MESSAGE[data?.reason] ?? '匯入失敗，請再試一次')
        if (data?.reason === 'preview_mismatch' || data?.reason === 'preview_expired') {
          setPhase('idle')
          setToken(null)
        }
      }
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const hasSkips =
    !!report &&
    (report.totals.validationErrors > 0 || report.totals.phoneNameConflicts > 0 || report.totals.plateConflicts > 0)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 bg-page px-6 py-10 text-ink">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">名單匯入</h1>
        <p className="mt-1 text-sm text-muted">P2 申請表 CSV 上傳（UTF-8）。匯入只寫資料紀錄，不會變動 LINE 綁定。</p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
        <p className="text-xs text-warning-fg">
          此檔含會友個資，請勿另存他處或貼到共用日誌。預覽結果依當下資料狀態產生，最終以「確認寫入」後的報告為準。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            className="text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-border file:bg-page file:px-4 file:text-ink hover:file:border-primary"
          />
          <button
            type="button"
            onClick={preview}
            disabled={!fileName || busy}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-strong disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {busy && phase === 'idle' ? '處理中…' : '上傳並預覽'}
          </button>
        </div>
        {error && (
          <p className="rounded-lg border border-danger-fg/30 bg-danger-bg px-4 py-2 text-sm text-danger-fg">{error}</p>
        )}
      </section>

      {report && phase === 'partial' && (
        <p className="rounded-xl border border-danger-fg/30 bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          匯入中途發生錯誤，可能已寫入部分資料
          {processedMembers !== null ? `（已處理 ${processedMembers} 位會友）` : ''}
          。請保留此檔、重新預覽後再匯入一次——匯入具冪等性，不會重複建立相同車輛。
        </p>
      )}

      {report && (
        <ReportView report={report} />
      )}

      {report && phase === 'previewed' && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
          {hasSkips && (
            <label className="flex items-start gap-2 text-sm text-warning-fg">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>上方標記為錯誤/衝突的列會被略過，其餘合法會友仍會寫入。我已了解並仍要匯入。</span>
            </label>
          )}
          <div>
            <button
              type="button"
              onClick={apply}
              disabled={busy || (hasSkips && !acknowledged)}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-strong disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {busy ? '寫入中…' : '確認寫入'}
            </button>
          </div>
        </section>
      )}

      {report && phase === 'applied' && (
        <section className="flex flex-col gap-3 rounded-xl border border-success-fg/30 bg-success-bg p-6">
          <p className="text-sm text-success-fg">
            匯入完成：新增 {report.imported} 位、更新 {report.updated} 位、車輛 +{report.vehiclesAdded}。
          </p>
          <div>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-sm text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              匯入下一份
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  )
}

function ReportView({ report }: { report: ImportReport }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="資料列" value={report.rows} />
        <Stat label="會友數" value={report.members} />
        <Stat label={report.dryRun ? '將新增' : '新增'} value={report.imported} />
        <Stat label={report.dryRun ? '將更新' : '更新'} value={report.updated} />
        <Stat label="車輛" value={report.vehiclesAdded} />
        <Stat label="眷屬" value={report.dependentsAdded} />
      </div>

      {report.truncated && (
        <p className="rounded-xl border border-warning-fg/30 bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          問題項目過多，各清單僅顯示前 500 筆（實際數量見各區塊標題）。
        </p>
      )}

      <IssueList
        title="格式錯誤（將略過）" total={report.totals.validationErrors}
        empty={report.validationErrors.length === 0}
      >
        {report.validationErrors.map((v, i) => (
          <li key={i}>第 {v.line} 列：{v.errors.join('；')}</li>
        ))}
      </IssueList>

      <IssueList
        title="同號不同名（將略過）" total={report.totals.phoneNameConflicts}
        empty={report.phoneNameConflicts.length === 0}
      >
        {report.phoneNameConflicts.map((c, i) => (
          <li key={i}>{c.phone}：{c.existingName ? `既有「${c.existingName}」vs 檔案「${c.names.join('／')}」` : c.names.join('／')}</li>
        ))}
      </IssueList>

      <IssueList
        title="車牌衝突（該車牌略過）" total={report.totals.plateConflicts}
        empty={report.plateConflicts.length === 0}
      >
        {report.plateConflicts.map((c, i) => (
          <li key={i}>{c.phone}：{c.plates.join('、')}</li>
        ))}
      </IssueList>

      <IssueList
        title="待覆核（已建立、需人工補核）" total={report.totals.reviewRequired}
        empty={report.reviewRequired.length === 0}
        note={<Link href="/admin/eligibility" className="text-primary hover:underline">前往資格審查 →</Link>}
      >
        {report.reviewRequired.map((r, i) => (
          <li key={i}>{r.phone}（{r.reason}）</li>
        ))}
      </IssueList>
    </section>
  )
}

function IssueList({
  title, total, empty, note, children,
}: {
  title: string
  total: number
  empty: boolean
  note?: React.ReactNode
  children: React.ReactNode
}) {
  if (empty) return null
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}（{total}）</h3>
        {note}
      </div>
      <ul className="mt-2 space-y-1 text-sm text-muted">{children}</ul>
    </div>
  )
}
