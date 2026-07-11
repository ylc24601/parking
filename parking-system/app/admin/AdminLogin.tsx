'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Admin username/password login. The server collapses every failure (unknown
// account, wrong password, disabled, locked) into one 401 — the copy deliberately
// covers both "wrong" and "temporarily unavailable" without distinguishing them.
export default function AdminLogin() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        router.refresh()
        return
      }
      setError(
        res.status === 401 || res.status === 400
          ? '帳號或密碼錯誤，或帳號暫時無法登入'
          : '登入失敗，請稍後再試',
      )
      setPassword('')
    } catch {
      setError('連線失敗，請再試一次')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-10 text-slate-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">教會停車 · 管理後台</h1>
        <p className="mt-2 text-base text-slate-400">請以管理員帳號登入</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">帳號</span>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(null) }}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">密碼</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        <p className="h-6 text-base text-rose-400" role="alert">
          {error ?? ''}
        </p>

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="rounded-xl bg-sky-600 py-3 text-base font-medium text-white active:bg-sky-500 disabled:opacity-50"
        >
          {submitting ? '登入中…' : '登入'}
        </button>
      </form>
    </main>
  )
}
