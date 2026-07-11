import { maskPhone } from '@/lib/binding'
import { issueBindingCode } from '@/server/services/bindingAdminService'
import { createParkingRepository, type ParkingRepository } from '@/server/repositories/parkingRepository'

// ── Admin member management (Phase 8 Slice 2) ────────────────────────────────
// Search (masked list) + full detail (session-gated page only) + issue a binding
// code for an unbound member. The search query carries PII (name/phone/plate) and
// is never logged; the route uses POST so it never lands in a URL/access log.

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
// Per-branch fetch cap. Each ilike branch pulls at most this many candidate ids
// BEFORE the merge/distinct + slice(limit+1), so a broad match can never drag the
// whole table into memory, and hasMore stays correct after the merge.
const CANDIDATE_CAP = 250

// Minimum cleaned length per branch. Below these, the branch is skipped entirely —
// this is what prevents an empty cleaned value from becoming `ilike '%%'` (whole table).
const MIN_NAME = 1
const MIN_PHONE_DIGITS = 3
const MIN_PLATE_ALNUM = 2

export interface MemberSearchItem {
  id: string
  displayName: string
  phoneMasked: string
  plateSummary: string   // '' when no active plate; 'ABC-1234'; 'ABC-1234 ＋2'
  role: string
  bound: boolean
}

export async function searchMembers(
  params: { query: string; limit?: number },
  repo: ParkingRepository = createParkingRepository(),
): Promise<{ items: MemberSearchItem[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

  const raw = typeof params.query === 'string' ? params.query : ''
  // Strip LIKE wildcards: `.ilike()` parameterizes the value against filter-syntax
  // injection, but %/_ would still be interpreted as wildcards → strip them so a
  // query of "%" or "_" cannot match every row.
  const sanitized = raw.replace(/[%_]/g, '')

  // Name branch only fires when the query holds at least one letter or number (any
  // script, incl. CJK). Pure punctuation / symbols / emoji don't identify a member and
  // must not reach the DB — a lone `ilike '%!!!%'` isn't whole-table, but it's wasted work.
  const nameClean = sanitized.trim()
  const nameQuery =
    [...nameClean].length >= MIN_NAME && /[\p{L}\p{N}]/u.test(nameClean) ? nameClean : null

  const phoneDigits = sanitized.replace(/\D/g, '')
  const phoneQuery = phoneDigits.length >= MIN_PHONE_DIGITS ? phoneDigits : null

  const plateAlnum = sanitized.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const plateQuery = plateAlnum.length >= MIN_PLATE_ALNUM ? plateAlnum : null

  // Every branch empty (e.g. punctuation/emoji only, or too short) → no DB hit.
  if (nameQuery === null && phoneQuery === null && plateQuery === null) {
    return { items: [], hasMore: false }
  }

  const rows = await repo.searchMembers({ nameQuery, phoneQuery, plateQuery, candidateCap: CANDIDATE_CAP })
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(r => ({
    id: r.id,
    displayName: r.display_name,
    phoneMasked: r.phone_number === null ? '—' : maskPhone(r.phone_number),
    plateSummary: summarizePlates(r.plates),
    role: r.role,
    bound: r.line_id !== null,
  }))
  return { items, hasMore }
}

function summarizePlates(plates: string[]): string {
  if (plates.length === 0) return ''
  if (plates.length === 1) return plates[0]
  return `${plates[0]} ＋${plates.length - 1}`
}

export interface MemberDetail {
  displayName: string
  phone: string | null       // FULL — session-gated detail page only
  role: string
  bound: boolean             // derived; the raw line_id never reaches the client
  vehicles: Array<{ plate: string; nickname: string | null }>
  eligibility: {
    p2Eligible: boolean
    p2Reason: string | null
    p2ValidUntil: string | null
    p2ReviewDate: string | null
    reviewedAt: string | null
  } | null
  dependents: Array<{ kind: string; name: string; birthdate: string | null }>
}

export async function getMemberDetail(
  userId: string,
  repo: ParkingRepository = createParkingRepository(),
): Promise<MemberDetail | null> {
  const row = await repo.getMemberAdminDetail(userId)
  if (!row) return null
  return {
    displayName: row.display_name,
    phone: row.phone_number,
    role: row.role,
    bound: row.line_id !== null,   // drop the raw line_id; the client only needs the flag
    vehicles: row.vehicles.map(v => ({ plate: v.license_plate, nickname: v.nickname })),
    eligibility: row.eligibility
      ? {
          p2Eligible: row.eligibility.p2_eligible,
          p2Reason: row.eligibility.p2_reason,
          p2ValidUntil: row.eligibility.p2_valid_until,
          p2ReviewDate: row.eligibility.p2_review_date,
          reviewedAt: row.eligibility.reviewed_at,
        }
      : null,
    dependents: row.dependents.map(d => ({ kind: d.kind, name: d.name, birthdate: d.birthdate })),
  }
}

const MIN_TTL_DAYS = 1
const MAX_TTL_DAYS = 90

export type IssueMemberCodeResult =
  | { ok: true; code: string; expiresAt: string; displayName: string }
  | { ok: false; reason: 'member_not_found' | 'already_bound' }

// Issue a one-time binding code for an UNBOUND member (wraps issueBindingCode).
//
// The bound check is a UX PRECHECK, not an atomic guarantee: between this read and
// the binding_codes insert, another flow could complete the member's binding. That
// is acceptable — the authoritative gate is approve_pending_binding's
// `member_already_bound`, which refuses to bind an already-bound member. A successful
// issue only means a code row exists; it does NOT promise the code will approve later.
export async function issueMemberBindingCode(
  params: { userId: string; ttlDays?: number; note?: string | null; createdBy: string },
  repo: ParkingRepository = createParkingRepository(),
): Promise<IssueMemberCodeResult> {
  const ttlDays = params.ttlDays ?? 14
  if (!Number.isSafeInteger(ttlDays) || ttlDays < MIN_TTL_DAYS || ttlDays > MAX_TTL_DAYS) {
    throw new Error(`ttlDays must be an integer in ${MIN_TTL_DAYS}..${MAX_TTL_DAYS}`)
  }

  const detail = await repo.getMemberAdminDetail(params.userId)
  if (!detail) return { ok: false, reason: 'member_not_found' }
  if (detail.line_id !== null) return { ok: false, reason: 'already_bound' }

  const issued = await issueBindingCode(
    { userId: params.userId, ttlDays, createdBy: params.createdBy, note: params.note ?? null },
    repo,
  )
  return { ok: true, code: issued.code, expiresAt: issued.expiresAt, displayName: issued.displayName }
}
