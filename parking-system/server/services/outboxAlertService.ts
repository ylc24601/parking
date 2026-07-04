import type { OutboxHealth, ParkingRepository } from '@/server/repositories/parkingRepository'
import { createParkingRepository } from '@/server/repositories/parkingRepository'
import { getOutboxHealth } from './outboxHealthService'

// Phase 4 Slice F — scheduler-surfaced health alerting. Evaluates the operation-safe outbox_health
// aggregate against thresholds and reports whether the pipeline is healthy. The route encodes the
// verdict in the HTTP status (200 healthy / 503 unhealthy) so a dumb external monitor/cron can alert
// with zero integration. Output is aggregate-only: counts / status names / threshold names / a
// timestamp — never per-row / member data.

export interface AlertThresholds {
  failedMax: number            // alert when failed > this
  staleMax: number             // alert when stale_processing > this
  pendingStaleMinutes: number  // alert when the oldest DUE row is older than this (minutes)
}

// Sensitive pilot defaults: any terminal failed row or stale lease alerts; a due backlog older than
// 15 min means the scheduler isn't draining. Raise via env once a steady state is known.
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  failedMax: 0,
  staleMax: 0,
  pendingStaleMinutes: 15,
}

// Read a non-negative integer env var; missing / non-numeric / negative → fallback (fail-safe).
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) return fallback
  return n
}

export function readAlertThresholds(): AlertThresholds {
  return {
    failedMax: envInt('OUTBOX_ALERT_FAILED_MAX', DEFAULT_ALERT_THRESHOLDS.failedMax),
    staleMax: envInt('OUTBOX_ALERT_STALE_MAX', DEFAULT_ALERT_THRESHOLDS.staleMax),
    pendingStaleMinutes: envInt('OUTBOX_ALERT_PENDING_STALE_MINUTES', DEFAULT_ALERT_THRESHOLDS.pendingStaleMinutes),
  }
}

export interface OutboxAlert {
  healthy: boolean
  breaches: string[]           // operation-safe reason codes
  thresholds: AlertThresholds
  failed: number
  stale_processing: number
  oldest_due_at: string | null
}

// Pure: decide health from an outbox_health snapshot + thresholds. `now` is used only to age the
// oldest DUE row; a null oldest_due_at (nothing due) can never trip the backlog breach.
export function evaluateOutboxAlert(
  health: OutboxHealth,
  thresholds: AlertThresholds,
  now: Date,
): { healthy: boolean; breaches: string[] } {
  const breaches: string[] = []
  if (health.failed > thresholds.failedMax) breaches.push('failed_over_max')
  if (health.stale_processing > thresholds.staleMax) breaches.push('stale_processing_over_max')
  if (health.oldest_due_at !== null) {
    const ageMinutes = (now.getTime() - new Date(health.oldest_due_at).getTime()) / 60_000
    if (ageMinutes > thresholds.pendingStaleMinutes) breaches.push('due_backlog_stale')
  }
  return { healthy: breaches.length === 0, breaches }
}

export async function getOutboxAlert(
  params: { now?: Date } = {},
  repo: ParkingRepository = createParkingRepository(),
): Promise<OutboxAlert> {
  const now = params.now ?? new Date()
  const health = await getOutboxHealth({ now }, repo)
  const thresholds = readAlertThresholds()
  const { healthy, breaches } = evaluateOutboxAlert(health, thresholds, now)
  return {
    healthy,
    breaches,
    thresholds,
    failed: health.failed,
    stale_processing: health.stale_processing,
    oldest_due_at: health.oldest_due_at,
  }
}
