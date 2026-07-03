# Notification Dispatcher — Ops Runbook (Phase 4 Slice C)

How to schedule, preview, and monitor the LINE notification dispatcher that drains
`notification_outbox` (move-car requests, allocation/offer/release/reminder notices).

- Dispatch job: `POST|GET /api/internal/jobs/dispatch-notifications`
- Health/visibility: `GET /api/internal/jobs/outbox-status`
- CLIs: `npm run job:dispatch` · `npm run job:dispatch -- --dry-run` · `npm run job:outbox-status`

---

## Auth

Both routes accept **either** credential (fail-closed — an unset/empty secret is never a match):

| Credential | Header | Env var | Used by |
|---|---|---|---|
| Job secret | `x-job-secret: <secret>` | `JOB_TRIGGER_SECRET` | manual/CLI, external schedulers |
| Vercel Cron | `Authorization: Bearer <secret>` | `CRON_SECRET` | Vercel Cron (auto-added when `CRON_SECRET` is set) |

---

## Scheduling — pick ONE

Near-real-time move-car delivery needs the dispatcher to run every **1–2 minutes**.

### Option A — Vercel Cron (requires Vercel **Pro** for sub-daily)
1. Copy `parking-system/vercel.pro.example.json` → `parking-system/vercel.json`.
2. Set `CRON_SECRET` in the Vercel project env (Production). Vercel then sends
   `Authorization: Bearer $CRON_SECRET` on each invocation.
3. Deploy. Vercel Cron issues a **GET** to `/api/internal/jobs/dispatch-notifications` on the schedule.

> Vercel **Hobby** caps cron at **once per day** — not enough for move-car. Use Option B on Hobby.
> Do **not** commit a sub-daily `vercel.json` on a Hobby project: the deploy will fail.

### Option B — External scheduler (any host, incl. Hobby)
Point any scheduler at the route every 1–2 min with the job secret. Examples:

```bash
# crontab / cron-job.org / GitHub Actions step (every 2 minutes)
curl -fsS -X POST https://<host>/api/internal/jobs/dispatch-notifications \
  -H "x-job-secret: $JOB_TRIGGER_SECRET"
```

---

## Why overlapping runs are safe

Safety comes from **our outbox lease, not from the scheduler.** Each run atomically claims due rows
via `FOR UPDATE SKIP LOCKED`, flipping them to `processing` and stamping `locked_by`; terminal writes
are guarded on `status='processing' AND locked_by=<worker>`. So two invocations that overlap (a slow
run + the next cron tick, or two workers) each claim a **disjoint** set — a due row is pushed **at most
once**. Delivery is at-least-once; the LINE `X-Line-Retry-Key` (derived from `dedupe_key`) dedupes the
rare double from an expired lease. Regression-guarded by the "two dispatchers, one due row → exactly one
push" test in `tests/integration/notification-dispatch.db.test.ts`.

---

## Preview (no mutation)

See what a run *would* attempt without claiming/sending anything:

```bash
npm run job:dispatch -- --dry-run
# or:  GET /api/internal/jobs/dispatch-notifications?dryRun=1   (POST: { "dryRun": true })
# → { ok, dryRun:true, due, dueByTemplate, staleProcessing, batchLimit }
```

`dryRun` never resolves the transport and never claims — safe to run in any environment.

## Health / visibility

```bash
npm run job:outbox-status
# or:  GET /api/internal/jobs/outbox-status
```

Returns operation-safe aggregates: `due`, `due_by_template`, `pending`/`retrying`/`processing`/
`stale_processing`/`failed` counts, `failed_by_error` (sanitized error codes → counts, e.g.
`no_line_id`, `terminal_403`), `sent_last_24h`, and `oldest_pending_at`/`oldest_failed_at`/`next_retry_at`.
Reading it:
- **`failed` climbing / `failed_by_error.no_line_id` high** → recipients aren't bound to the OA (ops:
  push OA onboarding + `line_id` binding).
- **`stale_processing` > 0 persistently** → workers dying mid-send; the next run reclaims them (lease),
  but investigate if it stays high.
- **`due` grows without draining** → the scheduler isn't running (check cron/secret).

All responses are counts / notification-type names / sanitized codes / timestamps **only** — never
`line_id`, `user_id`, phone, plate, message body, penalty, or pastoral data.

---

## Production env guard

In a production runtime (`VERCEL_ENV=production`, else `NODE_ENV=production`), the real send path
**refuses `NOTIFICATION_TRANSPORT=mock`** (`500 mock_in_production`) so a misconfigured deploy fails fast
instead of silently dropping notifications. Production must set:

```
NOTIFICATION_TRANSPORT=line
LINE_CHANNEL_ACCESS_TOKEN=<channel access token>   # missing → 500 missing_line_token
```

(`dryRun`/`outbox-status` never touch the transport, so they work regardless.)
