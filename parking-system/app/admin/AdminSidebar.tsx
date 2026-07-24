'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { can, type AdminCapability, type AdminRole } from '@/lib/adminRoles'
import LogoutButton from './LogoutButton'

// Persistent back-office nav (Slice 3.5 follow-up). Routes are unchanged — this is a
// shared shell over the existing admin pages, not an SPA. Rendered only when the
// layout has a session; it does NOT gate auth (pages/APIs keep their own checks).
// print:hidden on the shell: no admin page should print its navigation, and /admin/print
// is a paper sheet that must come out clean.
//
// Wave 2C-2 (#19): an item may carry a `capability`. Hiding it is UX ONLY — the real
// gate is the server-side check on each page and API (a clerk who types the URL still
// gets 「權限不足」). Items with no capability are open to every admin.
const NAV: Array<{ href: string; label: string; icon: string; capability?: AdminCapability }> = [
  { href: '/admin/bindings', label: '綁定審核', icon: '🔗' },
  { href: '/admin/members', label: '會友管理', icon: '👥' },
  { href: '/admin/accounts', label: '帳號管理', icon: '⚙️', capability: 'manage_admin_accounts' },
  { href: '/admin/eligibility', label: '資格審查', icon: '🏷️' },
  { href: '/admin/import', label: '名單匯入', icon: '📥' },
  { href: '/admin/print', label: '列印點名表', icon: '🖨' },
  { href: '/admin/capacity', label: '車位設定', icon: '🅿️' },
  { href: '/admin/ops', label: '營運狀態', icon: '📊', capability: 'view_ops' },
  { href: '/admin/audit', label: '稽核記錄', icon: '📜', capability: 'view_audit' },
  { href: '/admin/pastoral', label: '牧養關懷', icon: '💚' },
  { href: '/admin/staff-pin', label: '現場 PIN 管理', icon: '🔑' },
]

// Boundary-safe: /admin matches only itself; a section matches itself and its nested
// routes (so /admin/members/[id] keeps 會友管理 active) — never a bare startsWith that
// would let /admin/member falsely match /admin/members.
function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminSidebar({ username, role }: { username: string; role: AdminRole }) {
  const pathname = usePathname()
  const homeActive = pathname === '/admin'
  const nav = NAV.filter(item => !item.capability || can(role, item.capability))
  return (
    <div className="sticky top-0 z-20 flex flex-col border-b border-border bg-surface print:hidden lg:h-dvh lg:w-56 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      {/* brand + username (mobile: logout shares this row) */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <Link
            href="/admin"
            aria-current={homeActive ? 'page' : undefined}
            className="inline-flex min-h-11 items-center text-base font-bold text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            ⛪ 管理後台
          </Link>
          <p className="truncate text-xs text-muted">{username}</p>
        </div>
        <div className="shrink-0 lg:hidden">
          <LogoutButton />
        </div>
      </div>

      {/* nav — mobile: one horizontally-scrollable row; desktop: vertical, grows to push logout down */}
      <nav
        aria-label="管理後台導覽"
        className="flex gap-1 overflow-x-auto overscroll-x-contain px-3 pb-2 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:px-2 lg:pb-2"
      >
        {nav.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border-b-2 px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:border-b-0 ${
                active
                  ? 'border-primary font-semibold text-primary lg:bg-success-bg lg:shadow-[inset_2px_0_0_var(--color-primary)]'
                  : 'border-transparent text-ink hover:text-primary lg:hover:bg-page'
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* desktop: logout pinned at the bottom (reachable via the sidebar's own scroll) */}
      <div className="hidden px-4 pb-4 lg:block">
        <LogoutButton />
      </div>
    </div>
  )
}
