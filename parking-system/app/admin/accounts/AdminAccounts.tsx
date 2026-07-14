'use client'

import { useState } from 'react'
import Badge, { type BadgeTone } from '../../ui/Badge'

// Admin account management. Peer model: every row except the operator's own is
// actionable; the operator's own row shows no buttons (self-target is refused by
// the API anyway, but hiding the buttons avoids a confusing 403). Destructive
// actions (disable/enable/revoke sessions, reset password) require an inline
// confirmation naming the TARGET USERNAME, so a stale list render or misclick
// can't silently hit the wrong account. A freshly reset password is shown ONCE —
// it lives only in this component's local state, is cleared the moment the
// operator closes it or starts any other action, and is never written to
// localStorage/sessionStorage/URL/log.

interface AccountItem {
  id: string
  username: string
  displayName: string | null
  status: 'active' | 'disabled' | 'locked'
  createdAt: string
}

const STATUS_LABEL: Record<AccountItem['status'], string> = {
  active: '啟用中',
  disabled: '已停用',
  locked: '鎖定中',
}
const STATUS_TONE: Record<AccountItem['status'], BadgeTone> = {
  active: 'success',
  disabled: 'danger',
  locked: 'warning',
}

type PendingConfirm =
  | { action: 'disable'; id: string; username: string }
  | { action: 'enable'; id: string; username: string }
  | { action: 'revoke'; id: string; username: string }
  | { action: 'reset'; id: string; username: string }

interface ResetResult {
  id: string
  username: string
  password: string
  disabled: boolean
}

const REASON_MESSAGE: Record<string, string> = {
  cannot_target_self: '無法對自己的帳號執行此操作',
  last_active_admin: '至少要保留一位啟用中的管理員，無法停用最後一位',
  not_found: '查無此帳號',
  invalid_request: '請求格式不正確',
}

export default function AdminAccounts({
  items,
  currentAdminId,
}: {
  items: AccountItem[]
  currentAdminId: string
}) {
  const [accounts, setAccounts] = useState(items)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function startAction(action: PendingConfirm['action'], id: string, username: string) {
    // Starting any new action clears a previously shown one-time password — it
    // must not linger while the operator's attention moves to another account.
    setResetResult(null)
    setCopied(false)
    setError(null)
    setPendingConfirm({ action, id, username } as PendingConfirm)
  }

  function cancelConfirm() {
    setPendingConfirm(null)
  }

  async function confirmAction() {
    if (!pendingConfirm || busyId) return
    const { action, id } = pendingConfirm
    setBusyId(id)
    setError(null)
    try {
      if (action === 'disable' || action === 'enable') {
        const res = await fetch('/api/admin/accounts/disable', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: id, disabled: action === 'disable' }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.ok) {
          setAccounts(prev =>
            prev.map(a => (a.id === id ? { ...a, status: action === 'disable' ? 'disabled' : 'active' } : a)),
          )
          setPendingConfirm(null)
        } else {
          setError(REASON_MESSAGE[data?.reason] ?? '操作失敗，請再試一次')
        }
      } else if (action === 'revoke') {
        const res = await fetch('/api/admin/accounts/revoke-sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: id }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.ok) {
          setPendingConfirm(null)
        } else {
          setError(REASON_MESSAGE[data?.reason] ?? '操作失敗，請再試一次')
        }
      } else {
        // reset
        const res = await fetch('/api/admin/accounts/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: id }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.ok) {
          setResetResult({ id, username: data.username, password: data.password, disabled: data.disabled })
          setPendingConfirm(null)
        } else {
          setError(REASON_MESSAGE[data?.reason] ?? '操作失敗，請再試一次')
        }
      }
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 bg-page px-6 py-10 text-ink">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">帳號管理</h1>
      </header>

      {error && (
        <p className="rounded-xl border border-danger-fg/30 bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</p>
      )}

      {resetResult && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <p className="rounded-lg border border-warning-fg/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
            請立即複製並安全轉交；關閉此視窗後，Admin UI 不會再次顯示這組密碼。
          </p>
          <p className="text-sm text-muted">帳號：{resetResult.username}</p>
          <div className="flex items-center gap-3">
            <code className="rounded-xl border border-primary/40 bg-success-bg px-5 py-3 text-xl font-semibold tracking-wide text-primary-deep">
              {resetResult.password}
            </code>
            <button
              type="button"
              onClick={async () => { await navigator.clipboard?.writeText(resetResult.password); setCopied(true) }}
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <p className="text-sm text-muted">
            {resetResult.disabled
              ? '密碼已重設；此帳號目前為停用狀態，需先重啟才能登入。'
              : '密碼已重設；該帳號所有裝置已登出，需以新密碼重新登入。'}
          </p>
          <div>
            <button
              type="button"
              onClick={() => { setResetResult(null); setCopied(false) }}
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning-fg/30 bg-warning-bg p-5">
          <p className="text-sm text-warning-fg">{confirmMessage(pendingConfirm)}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirmAction}
              disabled={busyId !== null}
              className="inline-flex min-h-11 items-center rounded-lg bg-warning-fg px-4 text-sm font-semibold text-white transition-colors active:bg-warning-fg/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {busyId !== null ? '處理中…' : '確認'}
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              disabled={busyId !== null}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-ink transition-colors hover:border-primary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="w-full overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              <th className="px-4 py-3 font-normal">帳號</th>
              <th className="px-4 py-3 font-normal">顯示名稱</th>
              <th className="whitespace-nowrap px-4 py-3 font-normal">狀態</th>
              <th className="whitespace-nowrap px-4 py-3 font-normal">建立時間</th>
              <th className="px-4 py-3 font-normal"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map(a => {
              const isSelf = a.id === currentAdminId
              return (
                <tr key={a.id} className="bg-surface">
                  <td className="px-4 py-3 text-ink">{a.username}</td>
                  <td className="px-4 py-3 text-muted">{a.displayName ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant="outline" tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{a.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <div className="text-xs text-muted">
                        <Badge variant="outline" tone="neutral">目前登入</Badge>
                        <p className="mt-1">結束自己的 session 請用登出</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            startAction(a.status === 'disabled' ? 'enable' : 'disable', a.id, a.username)
                          }
                          className="inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          {a.status === 'disabled' ? '啟用' : '停用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startAction('reset', a.id, a.username)}
                          className="inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          重設密碼
                        </button>
                        <button
                          type="button"
                          onClick={() => startAction('revoke', a.id, a.username)}
                          className="inline-flex items-center whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs text-ink transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          撤銷所有 session
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function confirmMessage(pending: PendingConfirm): string {
  const { action, username } = pending
  if (action === 'disable') {
    return `確定停用 admin「${username}」？此操作會立即使其所有裝置登出。`
  }
  if (action === 'enable') {
    return `確定重啟 admin「${username}」？重啟後該帳號需重新登入。`
  }
  if (action === 'revoke') {
    return `確定撤銷 admin「${username}」的所有登入 session？`
  }
  return `確定重設 admin「${username}」的密碼？系統將產生新密碼並使其所有裝置登出。`
}
