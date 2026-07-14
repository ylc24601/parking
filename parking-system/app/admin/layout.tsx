import { getAdminSession } from '@/server/http/adminAuth'
import AdminSidebar from './AdminSidebar'

// Admin shell (Slice 3.5 follow-up). When logged in, wrap every /admin/* route in a
// persistent sidebar so navigation matches the mockup — routes stay independent, not
// an SPA. IMPORTANT: this session check ONLY decides whether to render the shell; it
// is NOT an auth gate. Every page and API keeps its own getAdminSession()/redirect
// (and /admin renders the login form itself when logged out) — do not remove those.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()
  if (!session) return <>{children}</> // login page renders bare, no sidebar

  return (
    <div className="flex min-h-dvh flex-col bg-page lg:flex-row">
      <AdminSidebar username={session.username} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
