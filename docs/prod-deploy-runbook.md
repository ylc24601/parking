# Phase 9 — Production deploy runbook (Vercel + Supabase Cloud)

> Status: **Slice 2 in progress** (2026-07-13). Scope per [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md):
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

## 6. Scheduling (Slice 3 — not yet wired)

The external-scheduler cron table (cron-job.org, `x-job-secret` header, per-job
method/expected-status/timeout/overlap policy) is scoped to Slice 3, once
`NOTIFICATION_TRANSPORT=line` and the LIFF app are wired. Placeholder — this section
will be filled in as part of that slice.

---

## 7. Slice 2 verification checklist

- [ ] Project ref/name/region recorded; three-way identity check passed before `db push`.
- [ ] `supabase migration list`: all 28 local migrations applied remotely, matching order/ids, no discrepancies.
- [ ] `npm run db:verify:remote` → 26/26.
- [ ] Vercel deploy succeeds (build log clean).
- [ ] Vercel env: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JOB_TRIGGER_SECRET` scoped to Production only (visually confirmed in Project Settings).
- [ ] `https://<vercel-domain>/admin` reachable, renders login form.
- [ ] A Preview deployment was triggered once; observed behavior recorded (`build failure — missing env` / `deployed, DB routes show ConfigError`); confirmed it has no production DB access either way.
- [ ] `admin:create` (no `--stdin`) succeeded; logged into `/admin` with the generated credentials.
- [ ] `ensure-weekly-event` called twice: first `created:true`, second `created:false` with the same `eventId`.
- [ ] Staff PIN issued via `/admin/staff-pin`; login proven at `/staff` in an incognito window; session cookie confirmed; logged out.
- [ ] Auth acceptance matrix (§4) confirmed row by row.
- [ ] No secrets, `SUPABASE_DB_URL`, or one-time passwords appear in this checklist's completed record (PR description / handoff notes) — only pass/fail outcomes.

---

## 8. Free → Pro upgrade (deferred to Slice 4 close-out)

Placeholder. Content to be filled in when the project moves from demo data to real
member data, per [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)'s
hosting guidance (Supabase Pro: no inactivity pausing, daily backups).

---

## 9. Slice 2 final security state (record at close-out, not just "tests passed")

- [ ] Admin credential: stored in password manager.
- [ ] Staff test session: logged out.
- [ ] Staff PIN issued in §3.3/3.4: final disposition recorded — revoked/rotated, **or**
      explicitly left to expire naturally (record the expiry time). Logging out the test
      session clears the cookie, not the PIN's validity.
- [ ] `JOB_TRIGGER_SECRET`: confirmed to exist only in the Vercel Production env and in
      the operator's local secure session — not left in shell history, a screenshot, or
      a chat/PR transcript.
