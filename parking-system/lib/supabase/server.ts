// MACHINE-ENFORCED server boundary. Importing this module (directly or transitively)
// from a Client Component is a BUILD-TIME error — not a comment asking nicely.
//
// What this prevents: privileged server-only code being pulled into a Client Component's
// dependency graph. An `import type` that someone later turns into a value import now
// fails the build instead of quietly becoming part of the client graph.
//
// What it is NOT: a bundling fix for the key itself. Next.js only inlines env vars
// prefixed with NEXT_PUBLIC_ and replaces the rest with an empty string, so the
// service-role key was never going to be emitted into browser JavaScript. The boundary
// is about which code is allowed to run where, not about that substitution.
//
// Every service/repository path reaches this file, so this one line guards the whole graph.
import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-only Supabase client using the SERVICE ROLE key. It bypasses RLS, so it
// MUST never be imported from client components or shipped to the browser.
// All member/Staff/Admin authorization is enforced in the app layer.

let cached: SupabaseClient | null = null

export function getServiceClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables (server-only).',
    )
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
