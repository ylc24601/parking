# Notification Dispatcher — Ops Runbook (Phase 4 Slice C)

How to schedule, preview, and monitor the LINE notification dispatcher that drains
`notification_outbox` (move-car requests, allocation/offer/release/reminder notices).

- Dispatch job: `POST|GET /api/internal/jobs/dispatch-notifications`
- Health/visibility: `GET /api/internal/jobs/outbox-status`
- CLIs: `npm run job:dispatch` · `npm run job:dispatch -- --dry-run` · `npm run job:outbox-status`
- **Admin UI (Phase 8 Slice 6, handoff §6.33): `/admin/ops`** — 同工登入即可看佇列健康度（含 alert banner、失敗分類）並做死信重送（預覽→確認）。與下方 CLI/內部 route 同一批 service，只是走 admin session 而非 job secret。健康讀取只讀一次 snapshot（banner 與統計一致）；重送預覽綁定條件、改欄位即失效。**排程/監控仍走內部 job route**（Admin UI 不排程）。

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

---

## Alerting (scheduler-surfaced, zero integration) — Phase 4 Slice F

```bash
npm run job:outbox-alert        # exits non-zero when unhealthy
# or schedule:  GET /api/internal/jobs/outbox-alert   (same x-job-secret / cron bearer auth)
```

The alert check evaluates `outbox_health` against thresholds and **encodes the verdict in the HTTP
status**: **200 healthy, 503 unhealthy**. Point any monitor/cron that treats non-2xx as an alert
(cron-job.org failure alerts, an uptime monitor, or `curl -f` in a crontab step) at it — no Slack/email
integration required. Body: `{ ok, healthy, breaches[], thresholds, failed, stale_processing, oldest_due_at }`.

`breaches` are operation-safe reason codes:
- **`failed_over_max`** — terminal `failed` rows exceed `OUTBOX_ALERT_FAILED_MAX`.
- **`stale_processing_over_max`** — stuck leases exceed `OUTBOX_ALERT_STALE_MAX`.
- **`due_backlog_stale`** — the oldest **due** row is older than `OUTBOX_ALERT_PENDING_STALE_MINUTES`
  (the dispatcher isn't draining). Uses `oldest_due_at`, so intentionally future-scheduled rows never
  trip it.

Thresholds are env-tuned (`.env.example`). **Sensitive pilot defaults: `0 / 0 / 15`** — any failed row
or stale lease alerts, and a due backlog older than 15 min means the scheduler is down/slow. Raise them
once a steady state is known. Suggested cadence: alert every 5–15 min.

---

## Dead-letter recovery (MANUAL-ONLY) — Phase 4 Slice F

**Do NOT schedule this.** `dispatch` and `outbox-alert` may be scheduled; `requeue-failed` is a
**human-run recovery step**, used **only after the root cause is fixed** (bad token / config / provider
outage resolved). It resets terminal `failed` rows back to `pending` for a fresh attempt.

```bash
npm run job:requeue-failed                          # DRY RUN by default → { wouldRequeue }
npm run job:requeue-failed -- --apply               # actually requeue (default max 50, hard cap 500)
npm run job:requeue-failed -- --apply --error terminal_403 --max 100
# or:  POST /api/internal/jobs/requeue-failed   body { "dryRun": false, "max": 100, "errorCode": "terminal_403" }
#      dryRun DEFAULTS TO true — you must send "dryRun": false to mutate.
```

Safety: **only `failed → pending`** (never touches `sent`/`processing`/`pending`/`retrying`); resets
`retry_count`/`next_retry_at`/`locked_*`/`last_error`; bounded batch; optional **sanitized** `errorCode`
filter (match the codes in `failed_by_error`, e.g. `terminal_403` — not raw provider text); no deletes /
no destructive cleanup. Idempotent: re-running requeues only whatever is currently `failed`. After a
successful requeue, the next dispatch run drains the rows; watch `outbox-alert` clear to 200.

---

## Rollback

- **Stop delivery:** disable the external cron job (remove the scheduled `dispatch` call). Rows keep
  queuing safely; nothing is lost.
- **Suspected bad send loop:** set `NOTIFICATION_TRANSPORT=mock` — dispatch then no-ops safely (note the
  prod `mock_in_production` guard: in a production runtime this fails fast rather than silently dropping,
  so use it in a non-prod/paused context or alongside pausing the scheduler).
- **Recover after a fix:** `requeue-failed` (dry-run first, then `--apply`).

---

## OA environment (go-live only)

This runbook's endpoints are transport-agnostic and tested with `NOTIFICATION_TRANSPORT=mock`. The
**church production OA is not wired here** — wiring `NOTIFICATION_TRANSPORT=line` +
`LINE_CHANNEL_ACCESS_TOKEN` is a **final pilot / production** step, gated on: real OA token setup,
message-copy sign-off (`move_car_request` / `reservation_released` / `reservation_cancelled`),
per-member `line_id` binding readiness, and rollback readiness (above). For manual verification before
then, use your own **test** OA via local env vars kept **outside the repo**.
