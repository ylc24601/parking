import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/server/http/adminAuth'
import { getOutboxHealth } from '@/server/services/outboxHealthService'
import { buildOutboxAlertFromHealth, readAlertThresholds } from '@/server/services/outboxAlertService'
import OpsDashboard from './OpsDashboard'

export const metadata: Metadata = {
  title: '營運狀態 · 管理後台',
}

// Operational numbers must be live, so this is uncacheable. A SINGLE health snapshot
// drives both the counts and the alert verdict (via buildOutboxAlertFromHealth) so the
// banner can never disagree with the stats. `router.refresh()` re-runs this fetch.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminOpsPage() {
  if (!(await getAdminSession())) redirect('/admin')

  const now = new Date()
  const health = await getOutboxHealth({ now })
  const alert = buildOutboxAlertFromHealth(health, readAlertThresholds(), now)

  return <OpsDashboard health={health} alert={alert} snapshotAt={now.toISOString()} />
}
