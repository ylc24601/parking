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

-- ── 22. requeue_failed_outbox exists + service_role execute (Phase 4 F) ─────────
do $$
begin
  perform 1 from pg_proc where proname = 'requeue_failed_outbox';
  if not found then raise exception 'FAIL: requeue_failed_outbox function missing'; end if;
  if not has_function_privilege('service_role', 'requeue_failed_outbox(timestamptz,int,text)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on requeue_failed_outbox';
  end if;
  raise notice 'PASS: requeue_failed_outbox present with service_role execute grant';
end $$;

-- ── 23. pending_binding table + partial unique index + capture RPC grant (Phase 5A) ─
do $$
begin
  perform 1 from pg_class where relname = 'pending_binding' and relkind = 'r';
  if not found then raise exception 'FAIL: pending_binding table missing'; end if;

  perform 1 from pg_indexes where indexname = 'pending_binding_active_uq';
  if not found then raise exception 'FAIL: pending_binding_active_uq partial unique index missing'; end if;

  perform 1 from pg_proc where proname = 'capture_pending_binding';
  if not found then raise exception 'FAIL: capture_pending_binding function missing'; end if;

  if not has_function_privilege('service_role', 'capture_pending_binding(text,text,text,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on capture_pending_binding';
  end if;
  if not has_table_privilege('service_role', 'pending_binding', 'insert') then
    raise exception 'FAIL: service_role lacks insert on pending_binding';
  end if;
  raise notice 'PASS: pending_binding table + active-uq index + capture_pending_binding grant present';
end $$;

-- ── 24. binding_codes + pending_binding audit cols + approve/reject RPC grants (Phase 5B) ─
do $$
begin
  perform 1 from pg_class where relname = 'binding_codes' and relkind = 'r';
  if not found then raise exception 'FAIL: binding_codes table missing'; end if;

  perform 1 from pg_indexes where indexname = 'binding_codes_code_key';
  if not found then raise exception 'FAIL: binding_codes_code_key unique index missing'; end if;

  -- pending_binding audit columns
  perform 1 from information_schema.columns
   where table_name = 'pending_binding'
     and column_name in ('approved_at', 'approved_user_id', 'rejected_at', 'rejected_reason')
   group by table_name having count(*) = 4;
  if not found then raise exception 'FAIL: pending_binding audit columns (approved_at/approved_user_id/rejected_at/rejected_reason) missing'; end if;

  perform 1 from pg_proc where proname = 'approve_pending_binding';
  if not found then raise exception 'FAIL: approve_pending_binding function missing'; end if;
  perform 1 from pg_proc where proname = 'reject_pending_binding';
  if not found then raise exception 'FAIL: reject_pending_binding function missing'; end if;

  -- 0022 re-signed approve_pending_binding to 4 args (expected-revision optimistic concurrency);
  -- 0025 re-signed both RPCs again with a defaulted p_admin_id (decider audit) — #27/#30
  -- also assert the stale overloads are gone.
  if not has_function_privilege('service_role', 'approve_pending_binding(uuid,bigint,timestamptz,boolean,uuid)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on approve_pending_binding';
  end if;
  if not has_function_privilege('service_role', 'reject_pending_binding(uuid,text,timestamptz,uuid)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on reject_pending_binding';
  end if;
  if not has_table_privilege('service_role', 'binding_codes', 'insert') then
    raise exception 'FAIL: service_role lacks insert on binding_codes';
  end if;
  raise notice 'PASS: binding_codes + pending_binding audit cols + approve/reject RPC grants present';
end $$;

-- ── 25. eligibility_dependents + users_phone_key + import_member RPC grant (Phase 6) ─
do $$
begin
  perform 1 from pg_type where typname = 'dependent_kind';
  if not found then raise exception 'FAIL: dependent_kind enum missing'; end if;

  perform 1 from pg_class where relname = 'eligibility_dependents' and relkind = 'r';
  if not found then raise exception 'FAIL: eligibility_dependents table missing'; end if;

  perform 1 from pg_indexes where indexname = 'eligibility_dependents_uq';
  if not found then raise exception 'FAIL: eligibility_dependents_uq unique index missing'; end if;

  perform 1 from pg_indexes where indexname = 'users_phone_key';
  if not found then raise exception 'FAIL: users_phone_key (phone identity) index missing'; end if;

  perform 1 from pg_proc where proname = 'import_member';
  if not found then raise exception 'FAIL: import_member function missing'; end if;
  if not has_function_privilege('service_role', 'import_member(text,text,text[],p2_reason,date,date,jsonb,boolean)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on import_member';
  end if;
  if not has_table_privilege('service_role', 'eligibility_dependents', 'insert') then
    raise exception 'FAIL: service_role lacks insert on eligibility_dependents';
  end if;
  raise notice 'PASS: eligibility_dependents + users_phone_key + import_member RPC grant present';
end $$;

-- ── 26. member_sessions table + hashed-token unique + RLS + grant (Phase 7 Slice 1) ─
do $$
begin
  perform 1 from pg_class where relname = 'member_sessions' and relkind = 'r';
  if not found then raise exception 'FAIL: member_sessions table missing'; end if;

  -- Cookie token is stored hashed; uniqueness on the hash is the lookup key.
  perform 1 from pg_indexes where indexname = 'member_sessions_token_hash_key';
  if not found then raise exception 'FAIL: member_sessions_token_hash_key unique index missing'; end if;

  perform 1 from pg_class where relname = 'member_sessions' and relrowsecurity;
  if not found then raise exception 'FAIL: member_sessions RLS not enabled'; end if;

  perform 1 from pg_constraint
    where conname = 'member_sessions_expiry_after_creation' and contype = 'c';
  if not found then raise exception 'FAIL: member_sessions_expiry_after_creation check missing'; end if;

  if not has_table_privilege('service_role', 'member_sessions', 'insert') then
    raise exception 'FAIL: service_role lacks insert on member_sessions';
  end if;
  if has_table_privilege('anon', 'member_sessions', 'select') then
    raise exception 'FAIL: anon must not read member_sessions';
  end if;
  raise notice 'PASS: member_sessions table + token_hash unique + RLS deny-all + service_role grant present';
end $$;

-- ── 27. LIFF binding claim: XOR shape + phone canon + capture/approve RPCs (Phase 7 Slice 2) ─
do $$
begin
  -- submitted_code relaxed to nullable (liff claims carry phone+name instead).
  perform 1 from information_schema.columns
    where table_name = 'pending_binding' and column_name = 'submitted_code' and is_nullable = 'YES';
  if not found then raise exception 'FAIL: pending_binding.submitted_code should be nullable'; end if;

  perform 1 from information_schema.columns
    where table_name = 'pending_binding' and column_name = 'claim_source'
      and column_default like '%keyword%';
  if not found then raise exception 'FAIL: pending_binding.claim_source default keyword missing'; end if;

  perform 1 from pg_constraint where conname = 'pending_binding_claim_source_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pending_binding_claim_source_ck missing'; end if;
  perform 1 from pg_constraint where conname = 'pending_binding_claim_shape_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pending_binding_claim_shape_ck (strict XOR) missing'; end if;
  perform 1 from pg_constraint where conname = 'pending_binding_claimed_phone_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pending_binding_claimed_phone_ck missing'; end if;
  perform 1 from pg_constraint where conname = 'pending_binding_claimed_name_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pending_binding_claimed_name_ck missing'; end if;
  perform 1 from pg_constraint where conname = 'users_phone_format_ck' and contype = 'c';
  if not found then raise exception 'FAIL: users_phone_format_ck (canonical phone) missing'; end if;

  perform 1 from pg_proc where proname = 'capture_liff_binding_claim';
  if not found then raise exception 'FAIL: capture_liff_binding_claim function missing'; end if;
  if not has_function_privilege('service_role', 'capture_liff_binding_claim(text,text,text,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on capture_liff_binding_claim';
  end if;
  if not has_function_privilege('service_role', 'capture_pending_binding(text,text,text,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on capture_pending_binding';
  end if;
  -- Expected-superseded_count revision guard (0022; since 0025 the signature carries a
  -- trailing defaulted p_admin_id). The old 3-arg signature must be gone.
  if not has_function_privilege('service_role', 'approve_pending_binding(uuid,bigint,timestamptz,boolean,uuid)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on approve_pending_binding(revision-guarded)';
  end if;
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'approve_pending_binding' and p.pronargs = 3;
  if found then raise exception 'FAIL: stale 3-arg approve_pending_binding still present'; end if;

  raise notice 'PASS: liff binding claim columns/constraints + capture/approve RPC grants present';
end $$;

-- ── 28. member apply RPC + allocation claim lock protocol (Phase 7 Slice 3) ─
do $$
begin
  perform 1 from pg_proc where proname = 'apply_reservation';
  if not found then raise exception 'FAIL: apply_reservation function missing'; end if;
  if not has_function_privilege('service_role', 'apply_reservation(uuid,uuid,uuid,boolean,smallint,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on apply_reservation';
  end if;
  -- The allocator's half of the apply-window locking protocol.
  perform 1 from pg_proc where proname = 'claim_friday_allocation';
  if not found then raise exception 'FAIL: claim_friday_allocation function missing'; end if;
  if not has_function_privilege('service_role', 'claim_friday_allocation(uuid,text)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on claim_friday_allocation';
  end if;
  raise notice 'PASS: apply_reservation + claim_friday_allocation RPCs + grants present';
end $$;

-- ── 29. offer expiry guard: apply_offer_resolution carries p_expiry_guard ──
do $$
begin
  -- 8-arg signature (p_expiry_guard); the old 7-arg one must be gone.
  if not has_function_privilege('service_role',
    'apply_offer_resolution(uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb,boolean)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on apply_offer_resolution(8-arg)';
  end if;
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_offer_resolution' and p.pronargs = 7;
  if found then raise exception 'FAIL: stale 7-arg apply_offer_resolution still present'; end if;
  raise notice 'PASS: apply_offer_resolution expiry-guard signature present (old 7-arg gone)';
end $$;

-- ── 30. Admin accounts + sessions + binding decider audit (Phase 8 Slice 1) ─
do $$
begin
  -- admin_accounts: structure + constraints
  perform 1 from pg_class where relname = 'admin_accounts' and relkind = 'r';
  if not found then raise exception 'FAIL: admin_accounts table missing'; end if;
  perform 1 from pg_indexes where indexname = 'admin_accounts_username_key';
  if not found then raise exception 'FAIL: admin_accounts_username_key unique index missing'; end if;
  perform 1 from pg_constraint where conname = 'admin_accounts_username_ck' and contype = 'c';
  if not found then raise exception 'FAIL: admin_accounts_username_ck (lowercase+format) missing'; end if;
  perform 1 from pg_constraint where conname = 'admin_accounts_password_hash_ck' and contype = 'c';
  if not found then raise exception 'FAIL: admin_accounts_password_hash_ck (scrypt prefix) missing'; end if;
  perform 1 from pg_constraint where conname = 'admin_accounts_display_name_ck' and contype = 'c';
  if not found then raise exception 'FAIL: admin_accounts_display_name_ck missing'; end if;
  perform 1 from pg_class where relname = 'admin_accounts' and relrowsecurity;
  if not found then raise exception 'FAIL: admin_accounts RLS not enabled'; end if;
  if not has_table_privilege('service_role', 'admin_accounts', 'insert') then
    raise exception 'FAIL: service_role lacks insert on admin_accounts';
  end if;
  if has_table_privilege('anon', 'admin_accounts', 'select') then
    raise exception 'FAIL: anon must not read admin_accounts';
  end if;

  -- admin_sessions: hashed-token mirror of member_sessions
  perform 1 from pg_class where relname = 'admin_sessions' and relkind = 'r';
  if not found then raise exception 'FAIL: admin_sessions table missing'; end if;
  perform 1 from pg_indexes where indexname = 'admin_sessions_token_hash_key';
  if not found then raise exception 'FAIL: admin_sessions_token_hash_key unique index missing'; end if;
  perform 1 from pg_constraint
    where conname = 'admin_sessions_expiry_after_creation' and contype = 'c';
  if not found then raise exception 'FAIL: admin_sessions_expiry_after_creation check missing'; end if;
  perform 1 from pg_class where relname = 'admin_sessions' and relrowsecurity;
  if not found then raise exception 'FAIL: admin_sessions RLS not enabled'; end if;
  if not has_table_privilege('service_role', 'admin_sessions', 'insert') then
    raise exception 'FAIL: service_role lacks insert on admin_sessions';
  end if;
  if has_table_privilege('anon', 'admin_sessions', 'select') then
    raise exception 'FAIL: anon must not read admin_sessions';
  end if;

  -- lock-cycle failure counter
  if not has_function_privilege('service_role', 'apply_admin_login_failure(uuid,timestamptz,int,int)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on apply_admin_login_failure';
  end if;

  -- binding decider audit: column + reason length bound + re-signed RPCs
  perform 1 from information_schema.columns
    where table_name = 'pending_binding' and column_name = 'decided_by_admin_id';
  if not found then raise exception 'FAIL: pending_binding.decided_by_admin_id missing'; end if;
  perform 1 from pg_constraint where conname = 'pending_binding_rejected_reason_len_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pending_binding_rejected_reason_len_ck missing'; end if;
  if not has_function_privilege('service_role', 'approve_pending_binding(uuid,bigint,timestamptz,boolean,uuid)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on approve_pending_binding(5-arg)';
  end if;
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'approve_pending_binding' and p.pronargs = 4;
  if found then raise exception 'FAIL: stale 4-arg approve_pending_binding still present'; end if;
  if not has_function_privilege('service_role', 'reject_pending_binding(uuid,text,timestamptz,uuid)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on reject_pending_binding(4-arg)';
  end if;
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reject_pending_binding' and p.pronargs = 3;
  if found then raise exception 'FAIL: stale 3-arg reject_pending_binding still present'; end if;

  raise notice 'PASS: admin_accounts + admin_sessions + login-failure RPC + binding decider audit present';
end $$;

-- ── 31. Admin account management RPCs (Phase 8 Slice 3) ─────────────────────
do $$
begin
  if not has_function_privilege('service_role', 'set_admin_disabled(uuid,uuid,boolean,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on set_admin_disabled';
  end if;
  if not has_function_privilege('service_role', 'reset_admin_password(uuid,uuid,text)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on reset_admin_password';
  end if;

  raise notice 'PASS: admin account management RPCs (set_admin_disabled, reset_admin_password) present';
end $$;

-- ── 32. Binding PII retention (Phase 8 Slice 7) ─────────────────────────────
do $$
declare
  v_def text;
begin
  -- claim-shape constraint must include the redacted-decided third arm
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'pending_binding_claim_shape_ck' and contype = 'c';
  if v_def is null then
    raise exception 'FAIL: pending_binding_claim_shape_ck missing';
  end if;
  if v_def !~* 'status.*approved.*rejected' then
    raise exception 'FAIL: pending_binding_claim_shape_ck lacks the redacted-decided arm';
  end if;

  perform 1 from pg_indexes where indexname = 'pending_binding_pii_retention_idx';
  if not found then raise exception 'FAIL: pending_binding_pii_retention_idx missing'; end if;

  if not has_function_privilege('service_role', 'redact_decided_binding_pii(timestamptz,int,int,boolean)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on redact_decided_binding_pii';
  end if;
  if has_function_privilege('anon', 'redact_decided_binding_pii(timestamptz,int,int,boolean)', 'execute') then
    raise exception 'FAIL: anon must not execute redact_decided_binding_pii';
  end if;

  raise notice 'PASS: binding PII retention (constraint arm, partial index, RPC grants) present';
end $$;

-- ── 33. Pastoral resolution + staff-PIN issuance audit (Phase 8 Slice 8) ─────
do $$
begin
  perform 1 from information_schema.columns
    where table_name = 'pastoral_care_alerts' and column_name = 'resolved_by_admin_id';
  if not found then raise exception 'FAIL: pastoral_care_alerts.resolved_by_admin_id missing'; end if;
  perform 1 from information_schema.columns
    where table_name = 'pastoral_care_alerts' and column_name = 'counter_reset';
  if not found then raise exception 'FAIL: pastoral_care_alerts.counter_reset missing'; end if;
  perform 1 from pg_constraint where conname = 'pastoral_care_alerts_note_len_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pastoral_care_alerts_note_len_ck missing'; end if;
  perform 1 from pg_constraint where conname = 'pastoral_care_alerts_resolution_shape_ck' and contype = 'c';
  if not found then raise exception 'FAIL: pastoral_care_alerts_resolution_shape_ck missing'; end if;

  perform 1 from information_schema.columns
    where table_name = 'staff_sessions' and column_name = 'created_by_admin_id';
  if not found then raise exception 'FAIL: staff_sessions.created_by_admin_id missing'; end if;

  if not has_function_privilege('service_role', 'resolve_pastoral_alert(uuid,uuid,text,boolean,timestamptz)', 'execute') then
    raise exception 'FAIL: service_role lacks execute on resolve_pastoral_alert';
  end if;
  if has_function_privilege('anon', 'resolve_pastoral_alert(uuid,uuid,text,boolean,timestamptz)', 'execute') then
    raise exception 'FAIL: anon must not execute resolve_pastoral_alert';
  end if;

  raise notice 'PASS: pastoral resolution columns/constraints/RPC + staff-PIN admin audit present';
end $$;

rollback;

\echo '== verify_schema.sql: all assertions passed =='
