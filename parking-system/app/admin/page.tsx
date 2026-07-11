import type { Metadata } from 'next'
import { getAdminSession } from '@/server/http/adminAuth'
import AdminHome from './AdminHome'
import AdminLogin from './AdminLogin'

export const metadata: Metadata = {
  title: '管理後台 · 教會停車',
}

// Server component: gate on the admin session. Logged out → username/password
// login. Logged in → the back-office home (nav skeleton; sections land per slice).
export default async function AdminPage() {
  const session = await getAdminSession()
  if (!session) return <AdminLogin />
  return <AdminHome username={session.username} />
}
