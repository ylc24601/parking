import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ── The server/client boundary, pinned ───────────────────────────────────────
// The real enforcement is `import 'server-only'`: pulling one of these modules into a
// Client Component fails `next build` (verified by hand on this branch — the build
// errors with "'server-only' cannot be imported from a Client Component module" and
// traces back to lib/supabase/server.ts).
//
// These tests exist because that enforcement is INVISIBLE in a diff. Deleting one
// `import 'server-only'` line looks like removing a stray import, and nothing fails
// until someone ships a service-role key to a browser. A build-time guard that can be
// silently deleted is a guard with a hole in it, so the guard itself is pinned here.

const ROOT = path.resolve(__dirname, '../../..')

// Every module that reads a secret from the environment AND is importable from other
// modules. Route handlers are deliberately absent: they are server entry points by
// construction, not something a component can import.
const SECRET_BEARING_MODULES = [
  'lib/supabase/server.ts', // SUPABASE_SERVICE_ROLE_KEY — the whole service/repo graph reaches this
  'server/http/jobAuth.ts', // JOB_TRIGGER_SECRET / CRON_SECRET
  'server/http/importConfirmToken.ts', // signs with the service-role key
  'server/services/notification/lineTransport.ts', // LINE_CHANNEL_ACCESS_TOKEN
]

describe('server-only boundary', () => {
  it.each(SECRET_BEARING_MODULES)('%s declares `import \'server-only\'`', (rel) => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8')
    expect(src).toMatch(/^import 'server-only'$/m)
  })

  // A comment asking people not to import something is not a boundary. If this list ever
  // shrinks, say why in the commit — do not just delete the entry.
  it('the pinned list still covers every env-secret reader outside route handlers', () => {
    const SECRET_NAMES = /SUPABASE_SERVICE_ROLE_KEY|LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|JOB_TRIGGER_SECRET|CRON_SECRET/
    const found: string[] = []
    for (const dir of ['lib', 'server']) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
        if (SECRET_NAMES.test(readFileSync(file, 'utf8'))) {
          found.push(path.relative(ROOT, file))
        }
      }
    }
    expect(found.sort()).toEqual([...SECRET_BEARING_MODULES].sort())
  })

  // The second half of the boundary: even a type-only import from a server module is a
  // latent hazard, because turning `import type` into a value import is a one-word edit
  // that a reviewer can miss. Client-safe DTOs live in lib/ instead (lib/memberAdminTypes,
  // lib/opsAdminTypes, …), so a Client Component has no reason to reach into server/ at all.
  it('no Client Component imports from @/server/, not even a type', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(ROOT, 'app'))) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
      const src = readFileSync(file, 'utf8')
      if (!/^\s*['"]use client['"]/m.test(src)) continue
      if (/from\s+['"]@\/server\//.test(src)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}
