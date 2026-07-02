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
