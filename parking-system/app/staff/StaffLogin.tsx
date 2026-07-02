'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Staff on-site PIN login. The server verifies against the active event's
// staff_sessions PIN (scrypt + lockout/expiry); too many wrong tries lock the PIN
// for a cooldown (423). The pad keeps no PIN state beyond the current entry.
const PIN_LENGTH = 6
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export default function StaffLogin() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(value: string) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      })
      if (res.ok) {
        router.refresh()
        return
      }
      setError(res.status === 423 ? '嘗試過多，請 15 分鐘後再試' : 'PIN 錯誤，請重新輸入')
      setPin('')
    } catch {
      setError('連線失敗，請再試一次')
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  function press(key: string) {
    if (submitting) return
    if (key === '⌫') {
      setPin(p => p.slice(0, -1))
      setError(null)
      return
    }
    if (!/\d/.test(key) || pin.length >= PIN_LENGTH) return
    const next = pin + key
    setPin(next)
    setError(null)
    if (next.length === PIN_LENGTH) void submit(next)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-8 px-6 py-10 text-slate-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">教會停車 · 現場點名</h1>
        <p className="mt-2 text-base text-slate-400">請輸入今日 PIN</p>
      </div>

      <div className="flex gap-3" aria-label="PIN 輸入進度">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border ${
              i < pin.length ? 'border-sky-400 bg-sky-400' : 'border-slate-600'
            }`}
          />
        ))}
      </div>

      <p className="h-6 text-base text-rose-400" role="alert">
        {error ?? ''}
      </p>

      <div className="grid w-full grid-cols-3 gap-3">
        {KEYS.map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => press(key)}
              disabled={submitting}
              className="flex h-16 items-center justify-center rounded-2xl bg-slate-800 text-2xl font-medium text-slate-100 active:bg-slate-700 disabled:opacity-50"
            >
              {key}
            </button>
          ),
        )}
      </div>
    </main>
  )
}
