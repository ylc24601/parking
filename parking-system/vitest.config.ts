import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // The gated `*.db.test.ts` integration tests share one local Supabase DB and
    // reuse fixed Sundays + seeded members (one-active-reservation-per-member is a
    // global unique index), so they must not run concurrently. Pure unit tests are
    // fast enough that serializing files at this scale costs nothing.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/allocation/**'],
      thresholds: { lines: 95, functions: 95, branches: 90 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
