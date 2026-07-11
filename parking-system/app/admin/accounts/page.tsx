import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/server/http/adminAuth'
import { listAdmins } from '@/server/services/adminAccountService'
import AdminAccounts from './AdminAccounts'

export const metadata: Metadata = {
  title: '帳號管理 · 管理後台',
}

// Account status must always be fresh (a just-disabled admin must never see a
// stale "active" render), so this page is uncacheable.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminAccountsPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin')

  const { items } = await listAdmins()
  return <AdminAccounts items={items} currentAdminId={session.adminId} />
}
