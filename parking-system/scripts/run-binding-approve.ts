// Approve a captured pending binding into users.line_id (Phase 5B Slice 2). DRY-RUN BY DEFAULT —
// prints a MASKED preview + the predicted outcome; pass --apply to actually write. Addressed by
// pending id only; raw line_user_id / full code never appear in output.
//   npm run binding:approve -- --pending-id <uuid>            # preview (no write)
//   npm run binding:approve -- --pending-id <uuid> --apply    # commit
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may be provided by the shell instead */
}

import { applyApproveBinding, previewApproveBinding } from '../server/services/bindingAdminService'

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const pendingId = argValue('--pending-id')
  if (!pendingId) throw new Error('usage: binding:approve --pending-id <uuid> [--apply]')
  const apply = hasFlag('--apply')

  const preview = await previewApproveBinding({ pendingId })
  console.log(JSON.stringify(preview, null, 2))

  if (!apply) {
    console.log(
      preview.wouldApprove
        ? '(dry run — would approve; re-run with --apply to write users.line_id)'
        : `(dry run — would NOT approve: ${preview.reason})`,
    )
    return
  }

  const result = await applyApproveBinding({ pendingId })
  console.log(JSON.stringify(result, null, 2))
  if (result.approved !== 1) {
    console.error(`not approved: ${result.reason}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
