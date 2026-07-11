import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/server/http/adminAuth'
import MemberSearch from './MemberSearch'

export const metadata: Metadata = {
  title: '會友管理 · 管理後台',
}

// Server component: session gate only. Search is interactive (client), and results
// carry PII, so nothing is fetched here — the client POSTs the query.
export default async function AdminMembersPage() {
  if (!(await getAdminSession())) redirect('/admin')
  return <MemberSearch />
}
