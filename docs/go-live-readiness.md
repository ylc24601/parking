# LINE OA Go-Live Readiness Plan

> **➡️ For the actual delivery-day checklist, use [go-live-checklist.md](go-live-checklist.md)** —
> it consolidates this doc's §1 (named owners) and §5 (pilot rollout) with the runbook's
> handover steps into one ordered, checkable list. THIS doc is the original 2026-07-04
> reasoning behind those decisions (why capture-only webhook, why a binding code over
> name+plate, `userId` scoping); its technical content still holds, but it is not the list
> you tick on delivery day.
>
> Status: **reviewed / planning only** (2026-07-04). Precedes any Phase 5 code.
> Scope guard: no webhook/LIFF/Member UI/migration is implemented by this doc. It sets the
> decisions, config posture, and slice order for going from "outbox writes but reaches nobody"
> to real LINE delivery. Related: `docs/oa-onboarding-and-move-car-copy.md`,
> `docs/dispatcher-ops.md`, `docs/current_handoff.md` §6.13–§6.18, `docs/v2-backlog.md`.

Phase 4 (A–F) is feature-complete and merged: notification backend, dispatcher (atomic
claim/lease, explicit `mock|line` transport, typed failure classification, sanitized errors),
health alerting (`/outbox-alert`), manual dead-letter requeue, and an external-scheduler runbook.
The **only remaining delivery blocker** is that nothing populates `users.line_id`, so the
dispatcher marks every row `no_line_id` and reaches no one even with a real token.

---

## 0. The constraint that reframes everything

You **cannot obtain a member's LINE `userId` (the value stored in `users.line_id`) by hand.**
The OA Manager console shows friends but never exposes their `userId`. The only mechanisms that
yield a `userId` are:

- a **webhook** (`source.userId` on a follow/message event), or
- **LIFF / LINE Login** (`liff.getProfile().userId`).

So **"manual admin import" is not a standalone option** — an admin can only import `userId`s that a
webhook or LIFF already captured. Go-live therefore requires crossing the no-webhook boundary
every prior slice deliberately held. This plan does that with the thinnest possible surface: a
capture-only webhook, no LIFF, no Member UI.

### `userId` scope (corrected)

LINE `userId` is issued **per Provider**, not simply per Channel — channels under the same
provider share a member's `userId`. **However, for safety we still treat any binding captured on a
test OA as throwaway, and production member bindings MUST be collected through the church
production OA.** Do not assume test-OA `userId`s are reusable in production even when providers
appear related; re-collect on the production channel.

---

## 1. Church-side decisions needed (mostly not code)

| Decision | Recommendation |
|---|---|
| **Which OA** | **Reuse the existing church OA.** Members already added it; the onboarding doc assumes it. A parking-only OA restarts the join-rate problem from zero. |
| **Token owner** | One named **OA admin owner** holds the channel access token + channel secret. Dev receives them only via a secret store, never in the repo. Define a rotation contact. |
| **Copy approver** | One named **approver** signs off the 3 provisional templates (`move_car_request`, `reservation_released`, `reservation_cancelled`) + the move-car A/B/C/D variants. No production send until signed. |
| **Scheduler / rollback operator** | One named **on-call operator** who can (a) disable the external scheduler, (b) hold transport at `mock`/`log`, (c) run `requeue-failed`. Runbook: `docs/dispatcher-ops.md`. |

**Gate:** nothing below starts until these four owners are named.

---

## 2. Dry-run posture — test OA optional, production OA allowed with hard send-lock

We **may skip a separate test OA and dry-run directly against the church production OA**, but the
dry-run is strictly limited to:

- **webhook intake** (receive follow/message events),
- **signature verification** (`X-Line-Signature` HMAC-SHA256 with the channel secret),
- **pending binding capture** (write pending records only — never `users.line_id`),
- **optional single test reply / test notification** to a known, consenting operator account.

This is safe on the production OA because the risky, congregation-wide failure mode is **auto-reply
/ broadcast**, and Phase 5A ships **capture-only, no auto-reply, no broadcast**. Push delivery is
`userId`-targeted, so any optional test send hits exactly one operator, not the friend base.

### Config lock during dry-run (required)

- **Do NOT enable production reservation notifications.** Keep `NOTIFICATION_TRANSPORT=mock` (or a
  `log` mode that records intent without sending).
- Keep a new **`LINE_SEND_ENABLED=false`** by default. Any real outbound call (the optional single
  test reply / test notification) is gated behind explicitly flipping `LINE_SEND_ENABLED=true` for
  that one test, then flipping it back.
- The existing fail-fast contract still holds: `transport=line` without a token aborts before
  claiming rows, and never marks rows `sent` without delivering.

---

## 3. `line_id` binding options — comparison

| Option | Member friction | Identity reliability | Security risk | Complexity | Fit |
|---|---|---|---|---|---|
| **Manual admin import** | n/a | — | — | Blocked: no source of `userId`s | Not viable alone |
| **Webhook + one-time binding code** | Low — member sends a code issued out-of-band | High (code proves the member) | Low with admin/script approval backstop | Webhook + pending store + approval | **Chosen first path** |
| **Webhook + free-text name+plate** | Lowest | Medium (a claim, not proof) | Impersonation of another's plate | Same as above + adjudication | Rejected as proof (see below) |
| **LIFF binding** | Clean in-LINE form | Highest | Low | LIFF app + Member UI + backend | Defer — reverses three boundaries at once |

**Prefer a one-time binding code over free-text name+plate.** Name/plate MAY be stored as **helper
metadata** on the pending record (to aid the approver), but is **not treated as proof of identity**.
The proof is the code plus human/script approval.

---

## 4. Identity verification — preventing wrong account ↔ wrong member

Layer these:

1. **Out-of-band one-time binding code** — church issues a short code to a *known* member through a
   trusted channel (small-group leader, registration desk, office). The member sends it via the OA;
   matching it is the primary proof that this `userId` belongs to this member.
2. **Name / plate as helper metadata only** — displayed to the approver, never authoritative.
3. **Admin / script approval** — no `userId` is written to `users.line_id` until a human (or a
   gated approval script) confirms. Backstop against impersonation and typos; fits the church's
   low-volume, high-trust setting.
4. **DB uniqueness already enforced** — the partial unique index `users_line_id_key` (`where
   line_id is not null`) blocks one LINE account binding to two members. The approval write must
   handle that conflict **explicitly** (surface it, don't swallow it).

---

## 5. Pilot rollout sequence

1. **Mock / log** — full binding + dispatch path with `NOTIFICATION_TRANSPORT=mock` (or `log`) and
   `LINE_SEND_ENABLED=false`. No real sends. Confirm pending records are created, approval writes
   `line_id`, dispatcher stops returning `no_line_id` for bound members, alerting/requeue behave.
2. **Production OA, capture + single test send** — real webhook intake + signature verify + pending
   capture on the church OA; optionally flip `LINE_SEND_ENABLED=true` for one test notification to a
   consenting operator, then flip back. Reservation notifications stay OFF.
3. **Small real cohort** — one small group binds via the code flow; approve them; enable delivery
   for that cohort only; watch `/outbox-alert` through at least one Sunday cycle before expanding.

**Verify before each expansion:** no unexplained terminal `failed` rows; no stale `processing`
leases; DUE backlog drains within threshold; copy approved; fallback text shows for un-bound owners;
no `line_id`/plate/body ever appears in logs or `last_error`.

---

## 6. Rollback (operator runbook — already supported)

1. **Disable the external scheduler** first — the dispatcher is pull-driven, so no scheduler = no
   sends.
2. **Hold transport at `mock`/`log`** (and `LINE_SEND_ENABLED=false`) to run the app without real
   delivery. Fail-fast means removing the token also halts real sends safely — it will not mark rows
   `sent`.
3. **Requeue `failed` rows only after the root cause is fixed** — `requeue-failed` is manual-only by
   design. Never replay into a broken transport.

---

## 7. Slice order

- **Phase 5A — LINE webhook + pending binding capture** (first code slice). Signature-verified
  webhook that records `{userId, submitted code, optional name/plate helper metadata}` into a **new
  `pending_binding` table**. **Does NOT write `users.line_id`.** Creates pending records only.
  Capture-only: no auto-reply, no broadcast (optional single gated test send aside).
- **Phase 5B — approval → `users.line_id` write.** Admin/script approval that promotes a verified
  pending record into `users.line_id`, **respecting the `users_line_id_key` partial unique index**
  (explicit conflict handling). After this, real delivery to bound members works with a production
  token. **Shipped: Slice 1 (RPCs, handoff §6.20) + Slice 2 (issue/approve/reject CLI, handoff
  §6.21).** Operator runbook: [binding-ops.md](binding-ops.md).

The smallest concrete Phase 5A implementation plan is proposed separately for review before any
code is edited.
