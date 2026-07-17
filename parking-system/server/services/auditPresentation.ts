// ── Audit presentation registry (Wave 2A-2 / #15) ────────────────────────────
// What an audit row is allowed to SHOW. This is not UI decoration — it is the
// read-side privacy boundary, and it is deliberately an ALLOWLIST.
//
// The write side is already an allowlist: 0030 assembles metadata inside each
// business RPC from fixed fields, and private.append_audit_log additionally
// refuses a denylist of PII-ish keys. But a denylist cannot know what it was never
// told about. A future RPC writing `eligibility_comment: '因罹患…'` passes that
// denylist untouched — the key simply isn't on it — and a generic "render whatever
// keys are present" viewer would print it to the page.
//
// So each action declares the keys it reads, and EVERYTHING ELSE IS IGNORED. Two
// independent layers (write-side denylist, read-side allowlist) means a gap in
// either one does not leak. #10's metadata is eligibility data — the most
// sensitive in the system — so this has to exist before #10 lands, not after.
//
// Exactly three outcomes, and no fourth:
//   known action + valid metadata  -> the action's own details
//   known action + wrong-typed key -> 'unreadable'   (never throw, never dump)
//   unknown action                 -> no details at all, raw code still shown
//
// An unknown action still renders its row: a gap in the timeline is worse than an
// unlabelled entry, because a missing row reads as "it never happened".

export interface AuditDetail {
  label: string
  value: string
}

export interface AuditActionDefinition {
  label: string
  // The keys this action may read. Anything outside this list is never rendered
  // and is counted as unsupported instead (see renderAuditDetails).
  reads: readonly string[]
  render(metadata: Record<string, unknown>): AuditDetail[] | 'unreadable'
}

const yesNo = (v: unknown): string | null =>
  typeof v === 'boolean' ? (v ? '是' : '否') : null

// Why 'denied' reasons are mapped rather than shown raw: they are RPC-internal
// codes. Unknown code falls back to the code itself (the MAP[x] ?? x idiom) — a
// reason we can't name is still a reason worth showing, and these are our own
// enum-like values, never user input.
const DENIED_REASON_LABEL: Record<string, string> = {
  last_active_admin: '不可停用最後一位系統管理員',
  cannot_target_self: '不可對自己執行',
}

function renderAdminAccountToggle(metadata: Record<string, unknown>): AuditDetail[] | 'unreadable' {
  const details: AuditDetail[] = []

  // A refusal row carries only `reason`; a success row carries the two booleans.
  if ('reason' in metadata) {
    const reason = metadata.reason
    if (typeof reason !== 'string') return 'unreadable'
    return [{ label: '結果原因', value: DENIED_REASON_LABEL[reason] ?? reason }]
  }

  const changed = yesNo(metadata.state_changed)
  if (changed === null) return 'unreadable'
  // state_changed=false is the honest half of a deliberate decision: a repeat
  // disable looks like a no-op but still revokes every session (0026:69 runs the
  // delete unconditionally), so the row is written rather than suppressed as
  // noise. Saying so plainly is the whole point of showing this field.
  details.push({
    label: '帳號狀態',
    value: changed === '是' ? '已變更' : '未變更（原本就是此狀態，但已強制重新登入）',
  })
  return details
}

const CAPACITY_DENIED_REASON: Record<string, string> = {
  capacity_below_promised: '可分配車位會少於已核准的數量',
  event_not_editable: '這一週已不可修改',
  allocation_in_progress: '本週分配正在執行中',
  negative_capacity: '保留·停用數超過總車位',
  version_conflict: '另一位管理員已先行修改',
}

const ACTIONS: Record<string, AuditActionDefinition> = {
  // #14A. effective_capacity_from/to are read straight from the row rather than
  // recomputed here: the formula already lives in two places on purpose (the pure
  // computeCapacity for the read path, the RPC's SQL for the transactional guard) and
  // presentation must not become a third.
  'weekly_event.capacity_update': {
    label: '修改車位容量',
    reads: [
      'total_capacity_from', 'total_capacity_to',
      'blocked_spaces_from', 'blocked_spaces_to',
      'effective_capacity_from', 'effective_capacity_to',
      'promised_count', 'reason', 'requested_effective_capacity',
      'expected_version', 'actual_version',
    ],
    render: metadata => {
      // A refusal row carries a reason instead of a from/to pair.
      if ('reason' in metadata) {
        const reason = metadata.reason
        if (typeof reason !== 'string') return 'unreadable'
        const details: AuditDetail[] = [
          { label: '未執行原因', value: CAPACITY_DENIED_REASON[reason] ?? reason },
        ]
        if (typeof metadata.requested_effective_capacity === 'number' && typeof metadata.promised_count === 'number') {
          details.push({
            label: '當時數字',
            value: `想改成可分配 ${metadata.requested_effective_capacity} 位，但已核准 ${metadata.promised_count} 位`,
          })
        }
        return details
      }

      const { total_capacity_from: tf, total_capacity_to: tt } = metadata
      const { blocked_spaces_from: bf, blocked_spaces_to: bt } = metadata
      const { effective_capacity_from: ef, effective_capacity_to: et } = metadata
      if ([tf, tt, bf, bt, ef, et].some(v => typeof v !== 'number')) return 'unreadable'

      return [
        { label: '總車位', value: `${tf} → ${tt}` },
        { label: '保留·停用', value: `${bf} → ${bt}` },
        { label: '可分配', value: `${ef} → ${et}` },
      ]
    },
  },

  // One aggregate marker written by migration 0031, so the timeline can explain why
  // 外賓保留 stopped being tracked separately from that instant.
  'weekly_event.admin_reserved_fold': {
    label: '外賓保留位併入「保留·停用」',
    reads: ['rows_affected', 'arithmetic_preserved'],
    render: metadata => {
      const rows = metadata.rows_affected
      if (typeof rows !== 'number') return 'unreadable'
      return [
        { label: '調整週次', value: `${rows} 週` },
        { label: '可分配車位', value: '不變（僅合併顯示方式）' },
      ]
    },
  },

  'admin_account.disable': {
    label: '停用管理員帳號',
    reads: ['disabled_to', 'state_changed', 'reason'],
    render: renderAdminAccountToggle,
  },
  'admin_account.enable': {
    label: '啟用管理員帳號',
    reads: ['disabled_to', 'state_changed', 'reason'],
    render: renderAdminAccountToggle,
  },
  'audit.substrate_enabled': {
    label: '稽核記錄啟用',
    reads: ['schema_version', 'historical_events_backfilled'],
    render: metadata => {
      const backfilled = yesNo(metadata.historical_events_backfilled)
      if (backfilled === null) return 'unreadable'
      // The marker exists to say the trail starts HERE and that nothing before it
      // was invented. Spell that out rather than printing schema_version=2.
      return [{ label: '歷史紀錄', value: backfilled === '是' ? '已回填' : '未回填（紀錄自此開始）' }]
    },
  },
}

export const UNKNOWN_ACTION_DETAIL = '詳細資料目前無法顯示'
export const UNREADABLE_DETAIL = '詳細資料格式無法辨識'

// What this page is, and — more importantly — what it is NOT. Every clause is
// load-bearing:
//  · 「不是完整的操作紀錄」— the substrate raises the cost of FORGING a row, not of
//    skipping one. A reader must not treat「查不到」as「沒發生」.
//  · the staff clause — the on-site PIN is a shared per-event credential, so a
//    staff row names a session, never a person.
//  · retention — 2A-3 has NOT shipped, so nothing is being deleted yet. A flat
//    「紀錄保留 24 個月」would claim a deletion control that isn't running, which is
//    a false PRIVACY claim, not merely an inaccuracy.
//
// Lives here rather than in the page because a page file can't export a const for
// tests to import, and this copy is pinned by a test on purpose (see below).
export const AUDIT_BOUNDARY_NOTE =
  '此頁顯示重要異動紀錄（帳號、資格、車位設定等），不是完整的操作紀錄。' +
  '現場同工使用共用 PIN，只能追溯到當週的登入 session，無法辨識個人。' +
  '保留政策為 24 個月；自動清理將於後續維運功能啟用。'

export function auditActionLabel(action: string): string {
  return ACTIONS[action]?.label ?? action
}

export interface RenderedDetails {
  details: AuditDetail[]
  fallback: string | null
  // Extra keys present on a KNOWN action that no renderer claims. Surfaced as a
  // bare count so a developer who adds metadata without extending this registry
  // sees that something is missing — instead of it vanishing silently.
  //
  // A count, never the key names: `eligibility_comment` sitting beside a member
  // entity is itself mildly revealing, even with the value withheld.
  unsupportedCount: number
}

export function renderAuditDetails(action: string, metadata: unknown): RenderedDetails {
  const def = ACTIONS[action]

  // Unknown action: show nothing from metadata, and no count either. A count here
  // would read as「內容因權限不足而被隱藏」— false, and the opposite of what this
  // page is for.
  if (!def) return { details: [], fallback: UNKNOWN_ACTION_DETAIL, unsupportedCount: 0 }

  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { details: [], fallback: UNREADABLE_DETAIL, unsupportedCount: 0 }
  }
  const bag = metadata as Record<string, unknown>

  const rendered = def.render(bag)
  // A wrong-typed known key reports ONE fault, not two: no count alongside the
  // fallback, or the same broken field would show as「格式無法辨識」and
  // 「另有 1 項未顯示」at once.
  if (rendered === 'unreadable') {
    return { details: [], fallback: UNREADABLE_DETAIL, unsupportedCount: 0 }
  }

  const unsupportedCount = Object.keys(bag).filter(k => !def.reads.includes(k)).length
  return { details: rendered, fallback: null, unsupportedCount }
}
