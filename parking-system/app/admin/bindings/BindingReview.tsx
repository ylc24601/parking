'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PendingClaimListItem } from '@/server/services/bindingAdminService'

// Binding review queue (Phase 8 Slice 1). Everything sensitive arrived masked from
// the service; the ONLY deliberate full values on screen are claimedName +
// matchedDisplayName (the human comparison an approval is about). React keys and
// every API call use the FULL uuid — the 8-char shortId is display-only.

interface Preview {
  found: boolean
  pendingStatus?: string
  claimSource?: string
  claimVersion?: number
  lineUserIdMasked?: string
  submittedCodeMasked?: string | null
  claimedPhoneMasked?: string | null
  claimedName?: string | null
  matchedDisplayName?: string | null
  wouldApprove: boolean
  reason: string
}

// zh-TW operator guidance per typed reason (docs/binding-ops.md).
const REASON_COPY: Record<string, string> = {
  approved: '可核准',
  pending_not_found: '申請不存在（可能已被撤回），請重新整理清單',
  pending_not_pending: '此申請已被審核過，無需重做',
  pending_changed: '申請內容已在預覽後更新，請重新預覽',
  code_not_found: '綁定碼查無發碼紀錄：會友可能打錯，或尚未發碼',
  code_expired: '綁定碼已過期，請重新發碼',
  code_consumed: '綁定碼已被使用過，請重新發碼',
  phone_not_found: '申請手機對不到任何會友：請確認會友資料已匯入、手機正確；必要時退回並聯繫本人',
  member_already_bound: '對到的會友已綁定其他 LINE 帳號（不支援換綁）',
  line_id_taken: '此 LINE 帳號已綁定到別的會友，請查是否重複或錯綁',
}

function reasonCopy(reason: string): string {
  return REASON_COPY[reason] ?? reason
}

function fmtTaipei(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function sourceLabel(source: string): string {
  return source === 'liff' ? 'LIFF 自助申請' : '綁定碼'
}

export default function BindingReview({
  items,
  hasMore,
}: {
  items: PendingClaimListItem[]
  hasMore: boolean
}) {
  const router = useRouter()
  const [reviewItem, setReviewItem] = useState<PendingClaimListItem | null>(null)
  const [rejectItem, setRejectItem] = useState<PendingClaimListItem | null>(null)

  const closeAndRefresh = useCallback(() => {
    setReviewItem(null)
    setRejectItem(null)
    router.refresh()
  }, [router])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">
            ← 管理後台
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">綁定審核</h1>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
        >
          重新整理
        </button>
      </header>

      {hasMore && (
        <p className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          目前僅顯示最早送出的 {items.length} 筆，之後還有更多待審申請——請先完成部分審核後重新整理。
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center text-slate-400">
          目前沒有待審核的綁定申請
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-normal">ID</th>
                <th className="px-4 py-3 font-normal">來源</th>
                <th className="px-4 py-3 font-normal">申請內容</th>
                <th className="px-4 py-3 font-normal">首次送出</th>
                <th className="px-4 py-3 font-normal">最後更新</th>
                <th className="px-4 py-3 font-normal">重送</th>
                <th className="px-4 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map(item => (
                <tr key={item.id} className="bg-slate-950/40">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      title={`點擊複製完整 ID\n${item.id}`}
                      onClick={() => void navigator.clipboard?.writeText(item.id)}
                      className="font-mono text-slate-400 hover:text-slate-200"
                    >
                      {item.shortId}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{sourceLabel(item.source)}</td>
                  <td className="px-4 py-3 font-mono text-slate-200">{item.claim}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtTaipei(item.submittedAt)}</td>
                  <td className="px-4 py-3 text-slate-400">{fmtTaipei(item.lastUpdatedAt)}</td>
                  <td className="px-4 py-3 text-slate-400">{item.resubmits}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setReviewItem(item)}
                        className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600"
                      >
                        審核
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectItem(item)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-rose-700 hover:text-rose-300"
                      >
                        退回
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewItem && (
        <ReviewModal item={reviewItem} onClose={() => setReviewItem(null)} onDone={closeAndRefresh} />
      )}
      {rejectItem && (
        <RejectModal item={rejectItem} onClose={() => setRejectItem(null)} onDone={closeAndRefresh} />
      )}
    </main>
  )
}

function ModalShell({ title, children, onClose }: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200" aria-label="關閉">
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="break-all text-right text-slate-100">{value}</span>
    </div>
  )
}

// Preview → confirm. The confirm carries the previewed claimVersion; a claim
// re-submitted in between comes back 409 pending_changed → re-preview, never a
// sight-unseen approval.
function ReviewModal({ item, onClose, onDone }: {
  item: PendingClaimListItem
  onClose: () => void
  onDone: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'changed' | 'outcome'; text: string } | null>(null)
  // Bumped by 重新預覽 (after pending_changed); state resets happen in that handler,
  // the effect itself only applies async results.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let next: { preview?: Preview; error?: string }
      try {
        const res = await fetch('/api/admin/bindings/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pendingId: item.id }),
        })
        const data = await res.json().catch(() => null)
        next = res.ok && data?.ok
          ? { preview: data.preview as Preview }
          : { error: '預覽載入失敗，請關閉後重試' }
      } catch {
        next = { error: '連線失敗，請關閉後重試' }
      }
      if (cancelled) return
      if (next.preview) setPreview(next.preview)
      else setNotice({ kind: 'error', text: next.error ?? '預覽載入失敗' })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [item.id, reloadKey])

  function repreview() {
    setLoading(true)
    setPreview(null)
    setNotice(null)
    setReloadKey(k => k + 1)
  }

  async function approve() {
    if (!preview || preview.claimVersion === undefined || applying) return
    setApplying(true)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/bindings/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingId: item.id, claimVersion: preview.claimVersion }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        onDone()
        return
      }
      const reason: string = data?.reason ?? 'unknown'
      if (reason === 'pending_changed') {
        setNotice({ kind: 'changed', text: reasonCopy(reason) })
      } else {
        setNotice({ kind: 'outcome', text: reasonCopy(reason) })
      }
    } catch {
      setNotice({ kind: 'error', text: '連線失敗，請再試一次' })
    } finally {
      setApplying(false)
    }
  }

  const canApprove =
    !!preview && preview.found && preview.wouldApprove && preview.claimVersion !== undefined && !applying

  return (
    <ModalShell title="審核綁定申請" onClose={onClose}>
      {loading ? (
        <p className="py-8 text-center text-slate-400">載入預覽中…</p>
      ) : preview ? (
        <div className="flex flex-col gap-4">
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-2 text-sm">
            <PreviewField label="來源" value={preview.claimSource ? sourceLabel(preview.claimSource) : null} />
            <PreviewField label="LINE 帳號（遮罩）" value={preview.lineUserIdMasked} />
            <PreviewField label="綁定碼（遮罩）" value={preview.submittedCodeMasked} />
            <PreviewField label="申請姓名" value={preview.claimedName} />
            <PreviewField label="申請手機（遮罩）" value={preview.claimedPhoneMasked} />
            <PreviewField label="比對到的會友" value={preview.matchedDisplayName ?? (preview.found ? '（無）' : null)} />
          </div>

          <p
            className={`rounded-xl px-4 py-3 text-sm ${
              preview.wouldApprove
                ? 'border border-emerald-800 bg-emerald-950/40 text-emerald-300'
                : 'border border-amber-800 bg-amber-950/40 text-amber-300'
            }`}
          >
            {preview.wouldApprove ? '✓ 預檢通過：' : '✗ 無法核准：'}
            {reasonCopy(preview.reason)}
          </p>

          {notice && (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                notice.kind === 'changed'
                  ? 'border border-amber-800 bg-amber-950/40 text-amber-300'
                  : 'border border-rose-800 bg-rose-950/40 text-rose-300'
              }`}
            >
              {notice.text}
            </p>
          )}

          <div className="flex justify-end gap-3">
            {notice?.kind === 'changed' ? (
              <button
                type="button"
                onClick={repreview}
                className="rounded-xl bg-amber-700 px-4 py-2 text-sm text-white hover:bg-amber-600"
              >
                重新預覽
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void approve()}
                disabled={!canApprove}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {applying ? '核准中…' : '確認核准'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              關閉
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
            {notice?.text ?? '預覽載入失敗'}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

const REJECT_PRESETS = ['重複申請', '無法辨識申請人']

function RejectModal({ item, onClose, onDone }: {
  item: PendingClaimListItem
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = reason.trim()
  const tooLong = [...trimmed].length > 200

  async function submit() {
    if (!trimmed || tooLong || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/bindings/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingId: item.id, reason: trimmed }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        onDone()
        return
      }
      setError(reasonCopy(data?.reason ?? 'unknown'))
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="退回綁定申請" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          ⚠️ 退回原因會原樣存檔供稽核：請勿填入姓名、電話、綁定碼或 LINE ID。
        </p>

        <div className="flex flex-wrap gap-2">
          {REJECT_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => { setReason(preset); setError(null) }}
              className="rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            >
              {preset}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">退回原因（必填，200 字內）</span>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setError(null) }}
            rows={3}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          {tooLong && <span className="text-sm text-rose-400">已超過 200 字上限</span>}
        </label>

        {error && (
          <p className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!trimmed || tooLong || submitting}
            className="rounded-xl bg-rose-700 px-4 py-2 text-sm text-white hover:bg-rose-600 disabled:opacity-40"
          >
            {submitting ? '退回中…' : '確認退回'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            取消
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
