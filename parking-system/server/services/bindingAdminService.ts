import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'
import {
  BINDING_CODE_FORMAT,
  generateBindingCode,
  maskCode,
  maskLineUserId,
  normalizeBindingCode,
} from '@/lib/binding'

// Phase 5B Slice 2 — service layer behind the binding CLI. All member-facing values are masked
// here (server-side) before they reach any output; raw line_user_id / submitted_code never leave
// this layer except the one deliberate full-code return from issueBindingCode (the operator must
// read it to the member once).

const MAX_CODE_ATTEMPTS = 5

export interface IssuedCode {
  code: string          // FULL code — CLI prints it exactly once
  expiresAt: string
  userId: string
  displayName: string
}

export async function issueBindingCode(
  params: {
    userId: string
    ttlDays: number
    code?: string
    createdBy?: string | null
    note?: string | null
    now?: Date
  },
  repo: ParkingRepository = createParkingRepository(),
): Promise<IssuedCode> {
  const { userId, ttlDays, code, createdBy = null, note = null, now = new Date() } = params

  if (!Number.isInteger(ttlDays) || ttlDays < 1) {
    throw new Error(`--ttl-days must be a positive integer, got "${ttlDays}"`)
  }
  const displayName = await repo.getUserDisplayName(userId)
  if (displayName === null) throw new Error('user_id not found')

  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString()

  // Explicit code: single attempt, format-checked. A collision is a hard error (don't silently
  // reuse someone else's code).
  if (code !== undefined) {
    const normalized = normalizeBindingCode(code)
    if (!BINDING_CODE_FORMAT.test(normalized)) {
      throw new Error(`--code must match ${BINDING_CODE_FORMAT} after trim+uppercase, got "${normalized}"`)
    }
    const { inserted } = await repo.insertBindingCode({ code: normalized, userId, expiresAtIso: expiresAt, createdBy, note })
    if (!inserted) throw new Error('code already exists — choose another or omit --code to auto-generate')
    return { code: normalized, expiresAt, userId, displayName }
  }

  // Generated code: retry on the (rare) unique collision.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const generated = generateBindingCode()
    const { inserted } = await repo.insertBindingCode({ code: generated, userId, expiresAtIso: expiresAt, createdBy, note })
    if (inserted) return { code: generated, expiresAt, userId, displayName }
  }
  throw new Error(`failed to generate a unique code after ${MAX_CODE_ATTEMPTS} attempts`)
}

export interface ApprovePreview {
  found: boolean
  pendingStatus?: string
  lineUserIdMasked?: string
  submittedCodeMasked?: string
  matchedUserId?: string | null
  matchedDisplayName?: string | null
  wouldApprove: boolean
  reason: string
}

// Dry-run preview: masked display fields + the predicted typed reason (from the RPC, the single
// source of truth). Writes nothing.
export async function previewApproveBinding(
  params: { pendingId: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ApprovePreview> {
  const { pendingId, now = new Date() } = params
  const preview = await repo.getBindingApprovalPreview(pendingId)
  const predicted = await repo.approvePendingBinding({ pendingId, nowIso: now.toISOString(), dryRun: true })

  if (!preview) {
    return { found: false, wouldApprove: predicted.would_approve, reason: predicted.reason }
  }
  return {
    found: true,
    pendingStatus: preview.pending_status,
    lineUserIdMasked: maskLineUserId(preview.line_user_id),
    submittedCodeMasked: maskCode(preview.submitted_code),
    matchedUserId: preview.matched_user_id,
    matchedDisplayName: preview.matched_display_name,
    wouldApprove: predicted.would_approve,
    reason: predicted.reason,
  }
}

export async function applyApproveBinding(
  params: { pendingId: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<{ approved: number; reason: string }> {
  const { pendingId, now = new Date() } = params
  const res = await repo.approvePendingBinding({ pendingId, nowIso: now.toISOString(), dryRun: false })
  return { approved: res.approved, reason: res.reason }
}

export async function rejectBinding(
  params: { pendingId: string; reason: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<{ rejected: number; reason: string }> {
  const { pendingId, reason, now = new Date() } = params
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('--reason must not be empty')
  return repo.rejectPendingBinding({ pendingId, reason: trimmed, nowIso: now.toISOString() })
}
