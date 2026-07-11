'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Per-device logout: deletes this device's session row and clears the cookie.
export default function LogoutButton() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function logout() {
    if (submitting) return
    setSubmitting(true)
    try {
      await fetch('/api/admin/logout', { method: 'POST' })
    } catch {
      // Even a failed request falls through to refresh — the server clears the
      // cookie on success; on network failure the user can simply retry.
    } finally {
      setSubmitting(false)
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={submitting}
      className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
    >
      登出
    </button>
  )
}
