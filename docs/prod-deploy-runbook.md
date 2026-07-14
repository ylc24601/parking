# Phase 9 — Production deploy runbook (Vercel + Supabase Cloud)

> Status: **Slice 3 complete** (2026-07-14). Prod: `https://parking-omega-one.vercel.app` (Vercel Hobby) +
> Supabase `ybhszryuvoutkzkixsbk` (Tokyo). Scope per [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md):
> stand up prod before delivery, run demo-complete on the real prod stack as a deploy
> rehearsal. Church-side steps (production OA, real token, real member data, copy
> sign-off) are explicitly **post-delivery ops**, not covered here.
> Related: [dispatcher-ops.md](dispatcher-ops.md) (scheduling/rollback detail),
> [admin-account-ops.md](admin-account-ops.md) (admin lifecycle),
> [binding-ops.md](binding-ops.md), [member-liff-setup.md](member-liff-setup.md).

---

## 0. Prerequisites

No church-side owner is required for this phase — the demo runs on the developer's own
LINE OA/provider (see delivery-model doc), so the four owners named in
[go-live-readiness.md](go-live-readiness.md) §1 (OA token holder, copy approver,
scheduler/rollback operator) only matter for the **post-delivery** church rollout, not
for standing up prod itself.

You will need:
- A Supabase account (for the Cloud project).
- A Vercel account (Hobby plan is sufficient for this slice).
- The Supabase CLI (`supabase`, already a devDependency — `npx supabase ...`).
- A password manager to receive the admin account's one-time password.

---

## 1. Supabase Cloud — create + migrate

### 1.1 Create the project

Supabase Dashboard → New project:
- **Region: Tokyo (ap-northeast-1)** — nearest to Taiwan with real PII in play eventually.
- **Plan: Free** for this slice (demo data only; upgrade to Pro before real member data —
  see §8).

**Record immediately** (you'll need all three below): the **project ref**, the
**project name**, and the **region** shown on the project's dashboard/settings page.

### 1.2 Link the local repo

```bash
cd parking-system
npx supabase link --project-ref <ref>
```

**STOP — three-way identity check before doing anything else.** Confirm all three match:

1. The project ref shown on the Supabase **Dashboard**.
2. The ref you just passed to `supabase link --project-ref`.
3. The ref actually recorded in the local link metadata (`supabase/.temp/project-ref` or
   equivalent — inspect it, don't assume the flag "took").

```bash
EXPECTED_PROJECT_REF="<ref>"   # paste the ref from step 1.1
cat supabase/.temp/project-ref  # or the CLI's own "linked project" output
# — must equal $EXPECTED_PROJECT_REF exactly —
```

**Do not use the project name to identify the project** — names can be duplicated or
renamed later; the ref is the only stable identifier. Repeat this check before every
`db push` in this runbook, not just the first one.

### 1.3 Push migrations

```bash
npx supabase migration list          # BEFORE push — confirm remote is empty/expected
npx supabase db push
npx supabase migration list          # AFTER push — compare against the line below
```

**Acceptance: every one of the 28 local migration files (`0001`–`0028`) appears as an
applied remote entry, in the same order, with matching version ids.** No remote-only
entries, no local-only entries, no pending entries. If there is any discrepancy, **stop
and investigate the cause — do not run `supabase migration repair` to force the list
green.**

```bash
ls supabase/migrations/*.sql | wc -l   # sanity: should print 28
```

**Never run `supabase db reset` against a linked remote project.** That command is
local-stack-only; it drops and rebuilds the database and applies `supabase/seed.sql`
(explicitly marked dev-only — real member/vehicle/PII rows). All the commands in this
section (`link`, `db push`, `migration list`) are safe for remote; `db reset` is the one
command in this repo's toolkit that must never be pointed at Supabase Cloud.

### 1.4 Verify the pushed schema (catalog-only, safe on prod)

Get the **PostgreSQL connection string** (not the `https://` API URL) from Supabase
Dashboard → Connect. Prefer **Direct connection**; if your network doesn't support the
IPv6 direct connection requires, use the **Session pooler** string instead. Either way,
`SUPABASE_URL` (the `https://...` value used elsewhere in this repo) is a different
thing — `psql` needs a Postgres connection string, not an HTTP URL.

```bash
export SUPABASE_DB_URL="postgresql://...."   # quote fully if it has special characters
npm run db:verify:remote
unset SUPABASE_DB_URL
```

Expect **`verify_schema_prod.sql: all 26 assertions passed`**. This is a **different,
independent check** from the local `npm run db:verify` (33/33) — the local one exercises
behavior via DML inside a rolled-back transaction and depends on seed data (so it cannot
run against a fresh cloud database); this one is catalog-only (tables/indexes/
constraints/RPC signatures/grants) and has no DML dependency. Their counts are not
comparable and neither supersedes the other.

**Operational hygiene for `SUPABASE_DB_URL`:** keep it in a shell session variable only.
Never paste it into Vercel env, `.env.local`, or any committed file. Avoid it appearing
in a terminal screenshot. `unset` it when done, as above.

---

## 2. Vercel — create + configure

### 2.1 Create the project

Import the GitHub repo into a new **Hobby** Vercel project. Set **Root Directory** to
`parking-system/`.

### 2.2 Environment variables — Production scope ONLY

Set exactly three values, and **scope them to Production only** (uncheck Preview and
Development when adding each var in Vercel's UI):

| Var | Value |
|---|---|
| `SUPABASE_URL` | the cloud project's `https://<ref>.supabase.co` API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the cloud project's service-role key (Dashboard → API settings) |
| `JOB_TRIGGER_SECRET` | a **newly generated** secret — do NOT reuse the value from local `.env.local` |

**Do not set `CRON_SECRET`.** This phase schedules everything through
`JOB_TRIGGER_SECRET` via an external scheduler (cron-job.org, wired in Slice 3);
`CRON_SECRET` only matters if/when the project later upgrades to Vercel Pro and switches
to Vercel Cron.

**This is a hard gate before continuing to §3**: open Vercel Project Settings →
Environment Variables and visually confirm all three vars show **Production** only, not
Preview or Development. Production Supabase credentials must never be reachable by a
Preview deployment triggered by an arbitrary branch push.

### 2.3 Preview deployment policy (decided, not accidental)

This phase deliberately does **not** provision a second, non-production Supabase project
for Preview deployments (not worth the cost/maintenance for a single-operator demo
phase). Preview deployments therefore have **no Supabase env at all**. The actual
observed behavior — build-time failure, or a successful deploy where DB-dependent routes
show a `ConfigError` at runtime — depends on where this repo's env checks run; either is
an acceptable, intentional outcome of "no env provided," not a regression. Record which
one you actually observe in the §7 verification checklist below, and don't be alarmed by
a failing Preview deployment in future PRs — that is expected.

### 2.4 Do not commit `vercel.json`

`vercel.pro.example.json` in the repo root is a **reference only** for a future Vercel
Pro upgrade. Vercel Hobby's built-in cron only allows once-daily schedules — committing
a `vercel.json` with the sub-daily schedules in that example file will make the Hobby
deployment **fail outright**. All scheduling in this phase goes through the external
scheduler (Slice 3), not `vercel.json`.

---

## 3. Bootstrap — admin account, first event, first Staff PIN

Point your local shell at the cloud project (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
in `.env.local` or exported directly — cloud values, not local-stack ones).

### 3.1 Create the first admin account

**Before running this**: stop any screen recording or terminal-sharing session.

```bash
npm run admin:create -- --username <operator> --display-name "<display name>"
```

**Do not pass `--stdin` here** — `--stdin` means the *caller* supplies the password (piped
in) and the CLI does **not** print it; omitting `--stdin` is what makes the CLI *generate*
a random password and print it exactly once. This bootstrap flow wants the generated
path.

- Copy the printed one-time password into your password manager immediately.
- Do not paste the CLI output into chat, a PR description, or any log.
- Clear the terminal scrollback (or close the session) after saving the password.
- If the password is later lost, use the normal reset flow
  ([admin-account-ops.md](admin-account-ops.md)) or create a new account — never attempt
  to recover the plaintext from the DB (only the scrypt hash is stored).

### 3.2 Create the first weekly event, and prove it's idempotent

```bash
curl -s -X POST "https://<vercel-domain>/api/internal/jobs/ensure-weekly-event" \
  -H "x-job-secret: $JOB_TRIGGER_SECRET"
# → { "ok": true, "created": true, "eventId": "...", "sundayDate": "...", "status": "open" }

curl -s -X POST "https://<vercel-domain>/api/internal/jobs/ensure-weekly-event" \
  -H "x-job-secret: $JOB_TRIGGER_SECRET"
# → { "ok": true, "created": false, "eventId": "<SAME id>", ... }
```

The second call must return `created:false` with the **same** `eventId` as the first.
This single pair of calls validates: the job route works end-to-end against the cloud
DB, the unique-constraint conflict path, the read-back-on-conflict path, and
service-role write access — all in one step.

### 3.3 Issue the first Staff PIN (via Admin UI — the production path)

Log into `https://<vercel-domain>/admin` (a single route: unauthenticated renders the
login form, authenticated renders the back-office home) with the credentials from §3.1.
Navigate to **Staff PIN** and issue a PIN for the event created in §3.2.

`npm run staff:set-pin` (the CLI) is documented as an **emergency fallback only** (see
[admin-account-ops.md](admin-account-ops.md)'s "真的卡住時" section for the equivalent
posture on admin accounts) — it is not part of this bootstrap flow.

### 3.4 Prove the PIN actually works end-to-end

Issuing a PIN successfully only proves the write succeeded — it does not prove the hash,
expiry, and cookie path work over the real HTTPS deployment. Open an incognito/private
window to `https://<vercel-domain>/staff` and log in with the PIN from §3.3. Confirm:

- Login succeeds.
- A session cookie is set (this is also the first live confirmation that the `secure`
  cookie flag behaves correctly under Vercel's production HTTPS).
- Log out afterward to clear the test session.

**Record the PIN's final state** at the end of this slice (see §9) — logging out clears
the *cookie*, not the PIN itself.

---

## 4. Auth acceptance matrix

Verify by **route contract**, not "any secret gets 200 everywhere" — some routes are
legitimately unreachable this slice (LINE config isn't wired until Slice 3), and mutation
routes should not be exercised against prod just to prove auth works.

| Route | No secret | With `x-job-secret` |
|---|---|---|
| `GET /api/internal/jobs/outbox-status` (read-only, no LINE dependency) | 401 | 200 |
| `GET /api/internal/jobs/outbox-alert` | 401 | 200 or 503 (both prove auth passed; 503 = unhealthy thresholds, expect 200 since the outbox is empty this slice) |
| `POST /api/internal/jobs/ensure-weekly-event` | 401 | 200 (already exercised in §3.2) |
| `GET/POST /api/internal/jobs/dispatch-notifications` | 401 | **not tested this slice** — `NOTIFICATION_TRANSPORT` isn't configured for `line` yet, so a fail-fast error here is *correct* behavior, not a bug; real verification is Slice 3 |
| Any mutation-heavy job (`release`, `friday-allocation`, `settle`, etc.) | 401 | **not exercised this slice** — no reason to write against prod just to prove a 401 guard works |

---

## 5. Rollback

For dispatcher-specific rollback (transport downgrade, halting sends), see
[dispatcher-ops.md](dispatcher-ops.md) §Rollback — unchanged by this slice.

**This slice's specific note:** by the time §3 is complete, the cloud database is **not**
an empty environment — it holds an admin account, one weekly_event, a Staff PIN/session
row, and job-run audit rows. There is no member PII, reservation data, or real
notification traffic yet, so the blast radius of a config mistake is limited — but do
**not** casually reset or delete the cloud database to "start clean." If the project
needs to be rebuilt from scratch, explicitly revoke/discard the admin credentials and
`JOB_TRIGGER_SECRET` first; treat the existing project as holding live (if low-stakes)
credentials, not as a blank slate.

---

## 6. LINE/LIFF wiring + scheduling (Slice 3 — complete)

### 6.1 LINE Developers Console setup

Reused the existing test OA/provider from the Phase 5A/7 work (one LINE provider holding
both a **LINE Login channel**, which hosts the LIFF app, and the **Messaging API
channel**, i.e. the OA itself — the two must stay under the same provider or the
LIFF-obtained `userId` won't match the OA-side `userId`).

- **LIFF app**: Size `Full`, Scope `openid`+`profile`, Add friend `On (Normal)`,
  Endpoint URL pointed at `https://parking-omega-one.vercel.app/member` (previously a
  dev tunnel URL for local real-device testing — no code changes needed, this is a pure
  LINE-console setting).
- **Channel state**: confirmed **Published** (not Developing) — Developing blocks login
  for any LINE account without a role on the channel; this was the exact failure mode
  hit during the Phase 7 real-device smoke test (2026-07-11) and is a one-time, instant,
  no-review toggle for LINE Login channels.
- **Messaging API channel**: issued a fresh long-lived Channel Access Token (Phase 5A was
  capture-only and never needed one). Webhook URL set to
  `https://parking-omega-one.vercel.app/api/line/webhook`; **Verify** button in the
  console confirmed the signature chain end-to-end.
- **Two config values were pasted incorrectly on the first attempt** (`NEXT_PUBLIC_LIFF_ID`
  and `LINE_LOGIN_CHANNEL_ID` each briefly held the wrong ID — this OA has several
  similar-looking numeric IDs across the LIFF app / LINE Login channel / Messaging API
  channel, easy to cross-paste). Symptoms for future reference:
  - Wrong `NEXT_PUBLIC_LIFF_ID` → browser console shows
    `api.line.me/liff/v2/.../contextToken` returning **404** (LINE can't resolve that
    LIFF ID at all).
  - Wrong `LINE_LOGIN_CHANNEL_ID` → LINE's own `/oauth2/v2.1/verify` endpoint rejects the
    ID token's audience with a 4xx, which the app maps to the generic `登入已過期`
    (`invalid_token`) screen — not a token-expiry issue, an audience mismatch.
  - Both are fixed by re-copying the correct value from the LINE Login channel's LIFF
    tab / Basic settings tab respectively, and (for `NEXT_PUBLIC_LIFF_ID` specifically,
    since it's build-time-inlined) triggering a fresh build.

### 6.2 Vercel env additions (Production scope only, same gate as Slice 2)

`MEMBER_AUTH_MODE=liff`, `LINE_LOGIN_CHANNEL_ID`, `NEXT_PUBLIC_LIFF_ID`,
`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `NOTIFICATION_TRANSPORT=line`. All
six scoped to Production only, same as the Slice 2 three. `NEXT_PUBLIC_LIFF_ID` changes
need a fresh build (source + env both current); other vars need a redeploy but not
necessarily a rebuild-from-source — **verify by checking the deployment actually
serving traffic was created after the env change**, not just that *a* deploy happened.

### 6.3 End-to-end proof (developer's own account, real LINE delivery)

Rather than a synthetic/minimal test, the developer bound their own real LINE account
through the actual production flow: created one `users` row (real name/phone — this is
the developer's own identity, not Slice 4's synthetic demo cohort) → submitted the LIFF
claim form with matching info → approved via Admin UI `/admin/bindings` → re-opened LIFF,
confirmed auto-login reached the member status screen (landed on the "no vehicle
registered" guard, which is itself proof the full chain works, since that's a real
`MemberStatus` render, not the claim form). This exercised ID-token verification, claim
capture, admin approval, `users.line_id` write, and session re-entry all through real
code paths, with no shortcuts.

One real notification was then dispatched end-to-end: a `move_car_request` row was
inserted directly into `notification_outbox` (targeting this real bound account, the
nearest upcoming `weekly_events` row, `reservation_id=null` since no reservation
exists — the dispatcher only needs a real `users.line_id` and a real `weekly_event_id`,
confirmed by reading `claim_notification_outbox`'s actual join). The deployed
`dispatch-notifications` route was triggered manually; delivery was confirmed both by the
developer's phone actually receiving the LINE message and by a direct SQL check on that
specific `notification_outbox` row (`status=sent`, `sent_at` populated, `last_error`
null) — an aggregate `outbox-status` health check alone can't prove any *specific* row
sent.

**Webhook negative-path verified too**: a well-formed LINE `message` event (with
`message.type:"text"`, required by `pendingBindingService.ts`'s capture condition — an
earlier draft of this test omitted that field and would have measured nothing, since an
unsupported-shape event never reaches the signature-gated code path at all) sent with no
signature, then with a wrong signature, both got 401 and left `pending_binding`'s row
count unchanged.

### 6.4 Test identity cleanup decision (dependency-aware — do not just `DELETE FROM users`)

`notification_outbox.user_id` and `pending_binding.approved_user_id` are both **RESTRICT**
foreign keys (no cascade) — a naive delete of the test `users` row fails. A full FK
inventory against `users` was run (15 referencing columns across the schema); for this
specific developer account, only `notification_outbox` (1 row, the test push) and
`pending_binding` (1 row, the approval) were non-zero, plus `member_sessions` (1 row, but
that table *is* `on delete cascade`, so it's not a blocker). **Decision: A1** (full
delete is safe) — delete order: `notification_outbox` test row → `pending_binding`
approval row → `users` row itself (`member_sessions` auto-cascades). **Not yet
executed** — folded into the Slice 4 close-out per the master plan (see
[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) Phase 9 tracking / memory
notes for the running Phase 9 status).

### 6.5 cron-job.org scheduling — 11 jobs

**Scheduler timezone note**: the cron-job.org account in use is set to **Asia/Taipei**,
not UTC. Taipei has no DST, so this project deliberately writes every cron expression
below in **native Taipei local time** directly (no UTC conversion) — simpler and less
error-prone than fighting the account setting. If this account's timezone is ever
changed, or a new scheduler account is used, **every expression below must be
re-derived**, not copy-pasted as-is.

| Job | Route | Method/Body | Taipei intent | Cron (Asia/Taipei) | jobId |
|---|---|---|---|---|---|
| dispatch | `/api/internal/jobs/dispatch-notifications` | GET | every 2 min | `*/2 * * * *` | 8084498 |
| expire-offers | `/api/internal/jobs/expire-offers` | POST `{}` | every 10 min (staggered) | `3-53/10 * * * *` | 8084530 |
| outbox-alert | `/api/internal/jobs/outbox-alert` | GET | every 15 min (staggered) | `7-52/15 * * * *` | 8084531 |
| ensure-weekly-event | `/api/internal/jobs/ensure-weekly-event` | POST `{}` | daily 00:01 | `1 0 * * *` | 8084532 |
| friday-allocation | `/api/jobs/friday-allocation` | POST `{}` | Fri 18:00 | `0 18 * * 5` | 8084533 |
| auto-approve-temp | `/api/internal/jobs/auto-approve-temp` | POST `{}` | Sun 00:05 | `5 0 * * 0` | 8084534 |
| p2-arrival-reminder | `/api/internal/jobs/p2-arrival-reminder` | POST `{}` | Sun 10:20 | `20 10 * * 0` | 8084541 |
| release-window-a | `/api/internal/jobs/release` | POST `{}` | Sun 10:30–10:55 every 5 min | `30-55/5 10 * * 0` | 8084542 |
| release-window-b | `/api/internal/jobs/release` | POST `{}` | Sun 11:00 | `0 11 * * 0` | 8084543 |
| redact-binding-pii | `/api/internal/jobs/redact-binding-pii` | GET | daily 03:30 | `30 3 * * *` | 8084544 |
| auto-finalize | `/api/internal/jobs/auto-finalize` | POST `{}` | daily 04:07 (staggered) | `7 4 * * *` | 8084545 |

**Not scheduled** (by design): `requeue-failed` (manual-only, never automate), `outbox-status`
(read-only diagnostic), `/api/internal/jobs/settle` (ops fallback — the real trigger is
Staff's `/api/staff/settle` button, PIN-session-scoped, never on a cron).

`release` gets **two** scheduler jobs (window-a/b) for its one route — 10 routes → 11 jobs.
Every job's header carries `x-job-secret` only (never in URL query/body/job name).
`outbox-alert`'s `notification.onFailure` is enabled (verified via the API, not just the
UI) so a 503 triggers a failure email to the account's registered address (cron-job.org's
notification config has no per-job recipient override — it always goes to the account
email). Actually forcing one 503 to see the notification fire end-to-end is deferred to
before Slice 4 starts, not a Slice 3 blocker.

All 11 were created via cron-job.org's REST API (`PUT /jobs` — the console has no bulk
import, so this project scripted it) rather than the UI; the first batch of 5 succeeded
and the next 5 came back empty (undocumented rate limit) — retrying with a 2-second
delay between calls fixed it.

**Every job was manually triggered once post-creation and its response body checked**
(not just HTTP 200 — `ok:true`, all counters at `0` except `ensure-weekly-event`'s
`created:false`, no `error` field), confirming each is a legitimate no-op against the
current empty-of-real-data production database.

### 6.6 Operational incident: `JOB_TRIGGER_SECRET` briefly exposed in an AI chat transcript

While checking `outbox-alert`'s notification config via `GET /jobs/{id}`, the full API
response — which includes `extendedData.headers.x-job-secret` in plaintext — was pasted
into the conversation. **Rotated immediately**: new value generated, set in Vercel
Production env, redeploy triggered and confirmed **Ready** before proceeding (the first
rotation attempt failed silently because the redeploy hadn't actually finished serving
before the cron-job.org side was updated — chased down as a 401 on `dispatch`'s manual
trigger, fixed by regenerating once more and being stricter about waiting for the
deployment to reach Ready). All 11 cron-job.org jobs' headers were then updated via a
single scripted batch of `PATCH` calls. **Lesson for future ops sessions**: never ask for
or paste a job's full config via this API when a secret-bearing field like
`extendedData.headers` is involved — check status codes or specific non-secret fields
only.

---

## 7. Slice 2 verification checklist

> Slice 2 was closed at the 2B cloud checkpoint (project `ybhszryuvoutkzkixsbk` / Tokyo
> + Vercel `parking-omega-one.vercel.app`). Items below are ticked accordingly; the
> three that were operator-confirmed rather than witnessed step-by-step (migration-list
> exact match, env-scope visual confirmation, Preview-deployment behavior) are noted.

- [x] Project ref/name/region recorded; three-way identity check passed before `db push`.
- [x] `supabase migration list`: all 28 local migrations applied remotely, matching order/ids, no discrepancies. _(operator-confirmed)_
- [x] `npm run db:verify:remote` → 26/26.
- [x] Vercel deploy succeeds (build log clean).
- [x] Vercel env: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JOB_TRIGGER_SECRET` scoped to Production only (visually confirmed in Project Settings). _(operator-confirmed)_
- [x] `https://<vercel-domain>/admin` reachable, renders login form.
- [x] A Preview deployment was triggered once; confirmed it has no production DB access. _(operator-confirmed; exact outcome — build failure vs ConfigError — not separately recorded)_
- [x] `admin:create` (no `--stdin`) succeeded; logged into `/admin` with the generated credentials.
- [x] `ensure-weekly-event` called twice: first `created:true`, second `created:false` with the same `eventId`.
- [x] Staff PIN issued via `/admin/staff-pin`; login proven at `/staff` in an incognito window; session cookie confirmed; logged out.
- [x] Auth acceptance matrix (§4) confirmed row by row.
- [x] No secrets, `SUPABASE_DB_URL`, or one-time passwords appear in this checklist's completed record (PR description / handoff notes) — only pass/fail outcomes.

---

## 8. Free → Pro upgrade (deferred to Slice 4 close-out)

Placeholder. Content to be filled in when the project moves from demo data to real
member data, per [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)'s
hosting guidance (Supabase Pro: no inactivity pausing, daily backups).

---

## 9. Slice 2 final security state (record at close-out, not just "tests passed")

- [x] Admin credential: stored in password manager.
- [x] Staff test session: logged out.
- [x] Staff PIN issued in §3.3/3.4: **final disposition = rotated** (test PIN re-issued via
      the Admin UI for the same event; the old hash is dead). Logging out the test session
      clears the cookie, not the PIN's validity.
- [x] `JOB_TRIGGER_SECRET`: confirmed to exist only in the Vercel Production env and in
      the operator's local secure session — not left in shell history, a screenshot, or
      a chat/PR transcript.

---

## 10. Slice 3 verification checklist

- [x] LINE Login channel confirmed Published (not Developing).
- [x] LIFF Endpoint URL points at `https://parking-omega-one.vercel.app/member`.
- [x] Messaging API webhook URL set + Verify button passed in LINE console.
- [x] Vercel env: `MEMBER_AUTH_MODE`/`LINE_LOGIN_CHANNEL_ID`/`NEXT_PUBLIC_LIFF_ID`/
      `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`/`NOTIFICATION_TRANSPORT` all set,
      Production scope only; deployment confirmed built after the env change.
- [x] Webhook negative test: well-formed `message`-type event, missing signature → 401,
      wrong signature → 401, `pending_binding` row count unchanged across both.
- [x] Real LIFF login end-to-end: claim → admin approval → auto-login reaches
      `MemberStatus`.
- [x] Real LINE push delivered and confirmed via direct SQL row check
      (`status=sent`/`sent_at`/`last_error`), not just aggregate `outbox-status`.
- [x] Dependency-aware cleanup decision recorded for the test identity (§6.4) — **A1,
      not yet executed, deferred to Slice 4 close-out**.
- [x] cron-job.org scheduler timezone confirmed (Asia/Taipei) and every cron expression
      matches that timezone (native local time, not misapplied UTC values).
- [x] All 11 jobs created, next-run previews checked, each manually triggered once with
      response body verified (not just HTTP status).
- [x] `outbox-alert` failure notification enabled (verified via API read-back).
- [x] `JOB_TRIGGER_SECRET` rotation after the exposure incident (§6.6) verified working —
      `dispatch`/`expire-offers`/`outbox-alert` all re-tested 200 OK post-rotation.

## 11. Slice 3 final security state (record at close-out)

- [x] LINE Channel Access Token: owner = developer, issued 2026-07-14, stored in Vercel
      Production env + password manager only. Rotation/revocation: follow the explicit
      issue/revoke workflow LINE Developers Console currently provides — **do not assume
      issuing a replacement automatically invalidates the previous token**; after
      revocation, verify the old token fails against the LINE API. The token **must be
      replaced — not just have `NOTIFICATION_TRANSPORT` changed — before/at delivery or
      any church-OA switchover**.
- [x] `JOB_TRIGGER_SECRET`: rotated once already (see §6.6 incident) — current value
      confirmed live in Vercel Production and matching all 11 cron-job.org job headers;
      the exposed prior value is dead (superseded, not just "hopefully unused").
- [ ] Developer test identity (`users` row bound via real LIFF flow, §6.4): cleanup not
      yet executed — **A1 decision stands, action item for Slice 4 close-out**.
- [x] No secrets or the exposed `JOB_TRIGGER_SECRET` value appear in this document — only
      pass/fail outcomes and non-secret IDs (jobIds, event IDs).
