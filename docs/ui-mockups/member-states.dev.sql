-- Member UI state fixtures — DEV / LOCAL ONLY. NEVER run against production.
-- Phase 9 Slice 3.5 presentation verification: flip a seeded mock member into each
-- Member (/member) visual state so the light-green restyle can be checked at
-- 375 / 768 / 1280 px. Presentation-only: no new routes, no debug endpoints, no auth
-- bypass — just data. Run against the LOCAL Supabase after `db:reset`, one block at a
-- time, then `npm run db:reset` to restore the deterministic seed.
--
-- Login: MEMBER_AUTH_MODE=mock → open /member → enter the mock LINE userId noted below.
-- Seed refs (from supabase/seed.sql): member_01 = a0000000-…-0001 (mock id U_member_01,
-- plate ABC-1234, P2-eligible), open event = e0000000-…-0001, its reservation
-- = c0000000-…-0001. Times are UTC (10:30 Taipei = 02:30 UTC).

\set ev '''e0000000-0000-0000-0000-000000000001'''
\set rs '''c0000000-0000-0000-0000-000000000001'''

-- ── approved（已核准車位） — login U_member_01 ────────────────────────────────
update reservations set status='approved', attended_at=null, offer_expires_at=null,
  release_deadline_at = timestamptz '2026-06-21 02:30:00+00' where id = :rs;

-- ── temp_approved（候補遞補中，OfferActions） — offer 尚未過期 ────────────────
-- update reservations set status='temp_approved', attended_at=null,
--   offer_expires_at = now() + interval '2 hours' where id = :rs;

-- ── waiting（候補中） ─────────────────────────────────────────────────────────
-- update reservations set status='waiting', offer_expires_at=null, release_deadline_at=null where id = :rs;

-- ── on-the-way affordance（approved P2, 未到, deadline 未過 → OnTheWayButton） ──
-- member_01 是 P2（seed: user_eligibility mobility_long）。
-- update reservations set status='approved', effective_priority=2, p2_on_the_way=false,
--   attended_at=null, release_deadline_at = now() + interval '1 hour' where id = :rs;

-- ── cancelled（已取消卡 + 重新登記 apply 區並存） ─────────────────────────────
-- update reservations set status='cancelled_by_user' where id = :rs;

-- ── released_late / no_show（neutral 收尾狀態） ──────────────────────────────
-- update reservations set status='released_late' where id = :rs;   -- 或 'no_show'

-- ── apply（無 live reservation → 只顯示登記表單，需 event.status='open'） ──────
-- delete from reservations where id = :rs;

-- ── claim（未綁定 → BindingClaimForm）：不需 SQL ─────────────────────────────
--   用一個不存在於 users 的 mock id 登入（如 U_unbound_test）→ not_bound → 綁定申請表。

-- ── config-error：不需 SQL ───────────────────────────────────────────────────
--   以錯誤 env 啟動 dev：MEMBER_AUTH_MODE=liff 但未設 NEXT_PUBLIC_LIFF_ID（missing_liff_id），
--   或 MEMBER_AUTH_MODE 設非法值 → ConfigError 淺色頁。

-- ── 還原 ──────────────────────────────────────────────────────────────────────
--   npm run db:reset
