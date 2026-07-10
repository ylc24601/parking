# Delivery model & roadmap (church decision, 2026-07-06)

> Records a **delivery-model change** from the church and the resulting scope/roadmap. Supersedes the
> incremental "go-live gate by gate" assumption in [go-live-readiness.md](go-live-readiness.md) for
> *sequencing* (that doc's technical content still holds). Related: [binding-ops.md](binding-ops.md),
> [oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md).

## The change

The church wants **all development finished, then a single delivery** — not incremental go-live.

1. **Build to completion → demo-complete on the developer's own OA** (no church coordination needed to build/demo).
2. **Deliver once.**
3. **After delivery:** bulk-import member application data (name / plate / priority reason), then **gradually** onboard parking members to the church OA and bind.

**Consequence:** every church/OA/real-data step (church production-OA dry-run, real token, `NOTIFICATION_TRANSPORT=line`, copy sign-off, join-rate) **moves off the build critical path to post-delivery ops.** The build no longer waits on the church.

## Scope decisions (2026-07-06)

- **Two frontends are now IN scope** (were deferred): a **member-facing reservation UI** and an **Admin UI**. Today the only UI is the Staff check-in page; operator actions are CLIs.
- **Church staff operate** post-delivery → CLIs are not acceptable long-term; Admin UI must wrap member management, CSV import, eligibility review, and **bind approval**.
- **Member UI = LIFF-first.** LIFF captures LINE identity and creates a **pending binding/application for Admin approval — NO auto-bind in v1.** The existing `綁定 <code>` keyword flow (Phase 5A/5B) stays as **fallback + admin-assisted binding**.
- **Member UI eventually replaces the external "報名系統"** for reservations (reserve / cancel / check status in-system). Treat the external system as transitional; copy pointing to 報名系統 gets updated later.
- **Member data model:**
  - The **church application CSV is P2-only** (special-needs). Fields in [parking-application-form-fields.csv](parking-application-form-fields.csv).
  - **P3/general members self-onboard via the member UI.** A separate general-member CSV import path can be added later if the church provides one.
  - **Dependents get their own table** (multiple qualifying dependents over time — e.g. families with children born years apart). `user_eligibility` holds the **current eligibility summary**; `eligibility_dependents` holds the supporting evidence/details.
- **Hosting: Vercel + Supabase Cloud.** Region near Taiwan (Singapore/Tokyo) since it holds real PII; budget the Supabase **Pro tier** for production (no inactivity pausing, daily backups). Stand up prod **before delivery** and run **demo-complete on the real prod stack** (doubles as deploy rehearsal). Dispatcher via Vercel Cron.

## CSV → schema mapping (P2 application)

| Form field | → schema |
|---|---|
| `applicant_name` | `users.display_name` |
| `mobile_phone` | `users.phone_number` (member identity key) |
| `license_plate` (×N) | `vehicles.license_plate` |
| `reason_type` | `user_eligibility.p2_reason` (+ `p2_eligible=true`): 1→`mobility_long`, 2→`mobility_short`, 4→`elderly_companion`, 3→`child_companion`/`pregnancy` (split by `remarks`) |
| `impaired_person_name`/`elder_1_name`/`child_1..3_name` + birthdates | `eligibility_dependents` (detail) + summary on `user_eligibility` |
| `application_date`/`coded_date`/`reviewed_by` | audit |

`line_id` stays NULL at import; binding attaches it later.

## Revised roadmap

1. **Phase 6 — member import** (CLI first; the data foundation). Adds `eligibility_dependents`.
2. **Phase 7 — Member reservation UI (LIFF-first)**: reserve / cancel / status; LIFF captures identity → pending binding for Admin approval. P2-first (per prior rollout note).
3. **Phase 8 — Admin UI**: member mgmt + import + eligibility review + bind approval + ops visibility (wraps the CLIs).
4. **Phase 9 — Prod deploy (Vercel + Supabase Cloud) + demo-complete on prod.**
5. **Deliver.** Then **post-delivery ops runbook**: church OA wiring → real import → onboard + bind → copy sign-off → enable send (`NOTIFICATION_TRANSPORT=line`) → dispatcher scheduler.

## What is already done (unchanged)

Phases 0–4 (allocation, staff check-in, walk-in, stability, notifications/dispatcher, move-car) + Phase 5A (webhook capture) + 5B (binding approval RPCs + CLI, piloted on test OA 2026-07-05). Migrations 0001–0019; `db:verify` 24/24.
