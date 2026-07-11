'use client'

import { useState } from 'react'
import Link from 'next/link'

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
const STATUS_STYLE: Record<AccountItem['status'], string> = {
  active: 'border-emerald-800 text-emerald-300',
  disabled: 'border-rose-800 text-rose-300',
  locked: 'border-amber-800 text-amber-300',
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
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-10 text-slate-100">
      <header>
        <Link href="/admin" className="text-sm text-slate-400 hover:text-slate-200">← 管理後台</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">帳號管理</h1>
      </header>

      {error && (
        <p className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">{error}</p>
      )}

      {resetResult && (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-800 bg-slate-900 p-5">
          <p className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
            請立即複製並安全轉交；關閉此視窗後，Admin UI 不會再次顯示這組密碼。
          </p>
          <p className="text-sm text-slate-400">帳號：{resetResult.username}</p>
          <div className="flex items-center gap-3">
            <code className="rounded-xl border border-emerald-800 bg-slate-950 px-5 py-3 text-xl font-semibold tracking-wide text-emerald-300">
              {resetResult.password}
            </code>
            <button
              type="button"
              onClick={async () => { await navigator.clipboard?.writeText(resetResult.password); setCopied(true) }}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <p className="text-sm text-slate-400">
            {resetResult.disabled
              ? '密碼已重設；此帳號目前為停用狀態，需先重啟才能登入。'
              : '密碼已重設；該帳號所有裝置已登出，需以新密碼重新登入。'}
          </p>
          <div>
            <button
              type="button"
              onClick={() => { setResetResult(null); setCopied(false) }}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-800 bg-amber-950/40 p-5">
          <p className="text-sm text-amber-200">{confirmMessage(pendingConfirm)}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirmAction}
              disabled={busyId !== null}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {busyId !== null ? '處理中…' : '確認'}
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              disabled={busyId !== null}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-normal">帳號</th>
              <th className="px-4 py-3 font-normal">顯示名稱</th>
              <th className="px-4 py-3 font-normal">狀態</th>
              <th className="px-4 py-3 font-normal">建立時間</th>
              <th className="px-4 py-3 font-normal"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {accounts.map(a => {
              const isSelf = a.id === currentAdminId
              return (
                <tr key={a.id} className="bg-slate-950/40">
                  <td className="px-4 py-3 text-slate-100">{a.username}</td>
                  <td className="px-4 py-3 text-slate-400">{a.displayName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{a.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <div className="text-xs text-slate-500">
                        <span className="rounded-full border border-slate-700 px-2 py-0.5">目前登入</span>
                        <p className="mt-1">結束自己的 session 請用登出</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            startAction(a.status === 'disabled' ? 'enable' : 'disable', a.id, a.username)
                          }
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                        >
                          {a.status === 'disabled' ? '啟用' : '停用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startAction('reset', a.id, a.username)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                        >
                          重設密碼
                        </button>
                        <button
                          type="button"
                          onClick={() => startAction('revoke', a.id, a.username)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
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
