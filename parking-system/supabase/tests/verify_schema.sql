-- Phase 1 schema verification. Run AFTER `supabase db reset` (migrations + seed):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify_schema.sql
-- Every block either prints PASS or raises (aborting with non-zero exit). All work
-- happens inside a transaction that is rolled back, so the DB returns to seed state.

\set ON_ERROR_STOP on

begin;

-- Scratch event/users to keep negative tests off the seeded rows.
insert into weekly_events (id, sunday_date, total_capacity, blocked_spaces, admin_reserved)
  values ('e0000000-0000-0000-0000-000000000002', '2026-06-28', 23, 0, 0);

-- ── 1. Normalized-plate collision rejected ────────────────────────────────────
do $$
begin
  insert into vehicles (user_id, license_plate)
    values ('a0000000-0000-0000-0000-000000000003', 'abc1234');  -- normalizes to ABC1234 == ABC-1234
  raise exception 'FAIL: normalized plate collision was allowed';
exception when unique_violation then
  raise notice 'PASS: normalized plate collision rejected';
end $$;

-- ── 2. Duplicate (weekly_event_id, user_id) staff allocation rejected ─────────
do $$
begin
  insert into weekly_staff_allocations (weekly_event_id, user_id, status)
    values ('e0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'reserved');
  raise exception 'FAIL: duplicate staff allocation was allowed';
exception when unique_violation then
  raise notice 'PASS: duplicate staff allocation rejected';
end $$;

-- ── 3. Second active reservation for same (event, member) rejected ────────────
do $$
begin
  insert into reservations (weekly_event_id, user_id, vehicle_id, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003',
            'b0000000-0000-0000-0000-000000000003', 3, 'pending');
  raise exception 'FAIL: second active reservation was allowed';
exception when unique_violation then
  raise notice 'PASS: one-active-reservation-per-member enforced';
end $$;

-- ── 4. Approved reservation with NULL release_deadline_at rejected (Seam 1) ───
do $$
begin
  insert into reservations (weekly_event_id, user_id, vehicle_id, effective_priority, status, release_deadline_at)
    values ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003',
            'b0000000-0000-0000-0000-000000000003', 3, 'approved', null);
  raise exception 'FAIL: approved row without release_deadline_at was allowed';
exception when check_violation then
  raise notice 'PASS: approved row requires release_deadline_at';
end $$;

-- ── 5. Member reservation whose vehicle belongs to another user rejected (Seam 3) ─
do $$
begin
  insert into reservations (weekly_event_id, user_id, vehicle_id, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004',
            'b0000000-0000-0000-0000-000000000003', 3, 'pending');  -- vehicle b..03 belongs to member 3
  raise exception 'FAIL: cross-user vehicle reservation was allowed';
exception when foreign_key_violation then
  raise notice 'PASS: vehicle must belong to the reserving user';
end $$;

-- ── 6. Member reservation with NULL vehicle_id rejected (member-shape check) ──
do $$
begin
  insert into reservations (weekly_event_id, user_id, vehicle_id, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005',
            null, 3, 'pending');
  raise exception 'FAIL: member reservation without vehicle was allowed';
exception when check_violation then
  raise notice 'PASS: member reservation requires a vehicle';
end $$;

-- ── 7. Multiple users with NULL line_id allowed (partial unique index) ────────
do $$
begin
  insert into users (display_name, role) values ('未綁定A', 'staff');
  insert into users (display_name, role) values ('未綁定B', 'staff');
  raise notice 'PASS: multiple NULL line_id users allowed';
end $$;

-- ── 8. effective_priority outside (1,2,3) rejected ────────────────────────────
do $$
begin
  insert into reservations (weekly_event_id, user_id, vehicle_id, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005',
            'b0000000-0000-0000-0000-000000000005', 4, 'pending');
  raise exception 'FAIL: effective_priority=4 was allowed';
exception when check_violation then
  raise notice 'PASS: effective_priority constrained to 1..3';
end $$;

-- ── 9. Walk-in without a plate rejected ───────────────────────────────────────
do $$
begin
  insert into reservations (weekly_event_id, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 3, 'walk_in');
  raise exception 'FAIL: walk-in without plate was allowed';
exception when check_violation then
  raise notice 'PASS: walk-in requires a license plate';
end $$;

-- ── 10. v_weekly_capacity_inputs reports active P1 = 1 for the seeded event ────
do $$
declare v int;
begin
  select active_full_time_staff_reserved into v from v_weekly_capacity_inputs
    where weekly_event_id = 'e0000000-0000-0000-0000-000000000001';
  if v <> 1 then raise exception 'FAIL: expected active P1 = 1, got %', v; end if;
  raise notice 'PASS: v_weekly_capacity_inputs active P1 = 1';
end $$;

-- ── 11. staff_checkin_view exposes is_priority, hides reason/penalty ───────────
do $$
declare leaked int;
begin
  select count(*) into leaked from information_schema.columns
    where table_name = 'staff_checkin_view'
      and column_name in ('p2_reason', 'penalty_score', 'consecutive_no_show', 'effective_priority');
  if leaked <> 0 then raise exception 'FAIL: staff_checkin_view leaks % sensitive column(s)', leaked; end if;
  perform 1 from information_schema.columns
    where table_name = 'staff_checkin_view' and column_name = 'is_priority';
  if not found then raise exception 'FAIL: staff_checkin_view missing is_priority'; end if;
  raise notice 'PASS: staff_checkin_view exposes is_priority, no sensitive columns';
end $$;

-- ── 12. At most one OPEN pastoral_care_alert per user ─────────────────────────
do $$
begin
  insert into pastoral_care_alerts (user_id, weekly_event_id, reason, trigger_count)
    values ('a0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'consecutive_no_show', 4);
  insert into pastoral_care_alerts (user_id, weekly_event_id, reason, trigger_count)
    values ('a0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'consecutive_no_show', 5);
  raise exception 'FAIL: a second open pastoral_care_alert was allowed';
exception when unique_violation then
  raise notice 'PASS: only one open pastoral_care_alert per user';
end $$;

-- ── 13. Duplicate normalized walk-in plate per event rejected (Phase 3 v2) ─────
do $$
begin
  insert into reservations (weekly_event_id, walk_in_license_plate, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 'WK-1234', 3, 'walk_in');
  insert into reservations (weekly_event_id, walk_in_license_plate, effective_priority, status)
    values ('e0000000-0000-0000-0000-000000000002', 'wk1234', 3, 'walk_in');  -- normalizes to WK1234
  raise exception 'FAIL: duplicate normalized walk-in plate was allowed';
exception when unique_violation then
  raise notice 'PASS: duplicate normalized walk-in plate per event rejected';
end $$;

-- ── 14. staff_sessions: one PIN row per weekly_event (Phase 3 v2 PIN session) ──
do $$
begin
  insert into staff_sessions (weekly_event_id, pin_hash, expires_at)
    values ('e0000000-0000-0000-0000-000000000002', 'scrypt$00$00', now() + interval '12 hours');
  insert into staff_sessions (weekly_event_id, pin_hash, expires_at)
    values ('e0000000-0000-0000-0000-000000000002', 'scrypt$11$11', now() + interval '12 hours');
  raise exception 'FAIL: a second staff_sessions row for the same event was allowed';
exception when unique_violation then
  raise notice 'PASS: staff_sessions unique per weekly_event';
end $$;

-- ── 15. apply_staff_pin_failure exists + service_role can execute (Phase 3 v2) ─
do $$
begin
  perform 1 from pg_proc where proname = 'apply_staff_pin_failure';
  if not found then raise exception 'FAIL: apply_staff_pin_failure function missing'; end if;
  if not has_function_privilege('service_role', 'apply_staff_pin_failure(uuid,int)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on apply_staff_pin_failure';
  end if;
  raise notice 'PASS: apply_staff_pin_failure present with service_role execute grant';
end $$;

-- ── 16. notification_outbox lease columns + 'processing' status (Phase 4 A) ────
do $$
declare missing int;
begin
  select count(*) into missing
    from (values ('locked_at'), ('locked_by'), ('last_error')) as want(col)
    where not exists (
      select 1 from information_schema.columns
        where table_name = 'notification_outbox' and column_name = want.col);
  if missing <> 0 then raise exception 'FAIL: notification_outbox missing % lease column(s)', missing; end if;
  perform 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_status' and e.enumlabel = 'processing';
  if not found then raise exception 'FAIL: notification_status missing ''processing'' value'; end if;
  raise notice 'PASS: notification_outbox lease columns + processing status present';
end $$;

-- ── 17. claim_notification_outbox exists + service_role execute (Phase 4 A) ────
do $$
begin
  perform 1 from pg_proc where proname = 'claim_notification_outbox';
  if not found then raise exception 'FAIL: claim_notification_outbox function missing'; end if;
  if not has_function_privilege(
       'service_role', 'claim_notification_outbox(text,timestamptz,int,int)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on claim_notification_outbox';
  end if;
  raise notice 'PASS: claim_notification_outbox present with service_role execute grant';
end $$;

-- ── 18. staff_checkin_view exposes owner_notifiable, still hides line_id/phone (Phase 4 B) ─
do $$
declare leaked int;
begin
  perform 1 from information_schema.columns
    where table_name = 'staff_checkin_view' and column_name = 'owner_notifiable';
  if not found then raise exception 'FAIL: staff_checkin_view missing owner_notifiable'; end if;
  select count(*) into leaked from information_schema.columns
    where table_name = 'staff_checkin_view' and column_name in ('line_id', 'phone_number');
  if leaked <> 0 then raise exception 'FAIL: staff_checkin_view leaks % contact column(s)', leaked; end if;
  raise notice 'PASS: staff_checkin_view exposes owner_notifiable, hides line_id/phone';
end $$;

-- ── 19. outbox_health exists + service_role execute (Phase 4 C) ────────────────
do $$
begin
  perform 1 from pg_proc where proname = 'outbox_health';
  if not found then raise exception 'FAIL: outbox_health function missing'; end if;
  if not has_function_privilege('service_role', 'outbox_health(timestamptz,int)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on outbox_health';
  end if;
  raise notice 'PASS: outbox_health present with service_role execute grant';
end $$;

-- ── 20. apply_release 4-arg (owner notices) + 3-arg wrapper, service_role execute (Phase 4 D) ─
do $$
begin
  if not has_function_privilege('service_role', 'apply_release(uuid,timestamptz,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on 4-arg apply_release (owner notices)';
  end if;
  if not has_function_privilege('service_role', 'apply_release(uuid,timestamptz,jsonb)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on 3-arg apply_release wrapper';
  end if;
  raise notice 'PASS: apply_release 4-arg + 3-arg wrapper present with service_role execute grant';
end $$;

-- ── 21. apply_cancellation 8-arg (cancel notice) + 7-arg wrapper, service_role execute (Phase 4 E) ─
do $$
begin
  if not has_function_privilege('service_role', 'apply_cancellation(uuid,uuid,text,text,timestamptz,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on 8-arg apply_cancellation (cancel notice)';
  end if;
  if not has_function_privilege('service_role', 'apply_cancellation(uuid,uuid,text,text,timestamptz,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on 7-arg apply_cancellation wrapper';
  end if;
  raise notice 'PASS: apply_cancellation 8-arg + 7-arg wrapper present with service_role execute grant';
end $$;

rollback;

\echo '== verify_schema.sql: all assertions passed =='
