-- Phase 7 Slice 3: member reservation apply.
-- Until now reservations were created only by seed / walk-in; this adds the member-facing
-- apply as one atomic, typed RPC. Business logic (effective_priority per development_plan §4)
-- is computed in TypeScript (lib/allocation/priority.ts) and passed in; the RPC owns only the
-- transactional guards:
--   event_not_open → applications_closed → vehicle_not_owned → already_applied → applied
--
-- The apply window closes when the Friday allocation job claims the event: a job_runs row for
-- 'friday_allocation' (see FRIDAY_ALLOCATION_JOB in fridayAllocationService.ts — keep in sync)
-- in 'running' or 'success'. Rows inserted after the allocator read its pending snapshot would
-- otherwise sit 'pending' forever; late members go through Sunday walk-in instead
-- (waiting-tail join is v2 backlog).

create or replace function apply_reservation(
  p_event_id           uuid,
  p_user_id            uuid,
  p_vehicle_id         uuid,
  p_requested_p2       boolean,
  p_effective_priority smallint,
  p_now                timestamptz
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_id     uuid;
begin
  select status into v_status from weekly_events where id = p_event_id;
  if not found or v_status <> 'open' then
    return jsonb_build_object('applied', 0, 'reason', 'event_not_open');
  end if;

  perform 1 from job_runs
    where weekly_event_id = p_event_id
      and job_type = 'friday_allocation'
      and status in ('running', 'success');
  if found then
    return jsonb_build_object('applied', 0, 'reason', 'applications_closed');
  end if;

  -- The vehicle must belong to the applicant and still be active.
  perform 1 from vehicles
    where id = p_vehicle_id and user_id = p_user_id and is_active;
  if not found then
    return jsonb_build_object('applied', 0, 'reason', 'vehicle_not_owned');
  end if;

  -- One active reservation per member per week: the partial unique index
  -- reservations_one_active_per_member is the authoritative guard (cancelled rows
  -- excluded, so a member may re-apply after cancelling).
  begin
    insert into reservations
      (weekly_event_id, user_id, vehicle_id, requested_p2_this_week, effective_priority,
       status, applied_at)
    values
      (p_event_id, p_user_id, p_vehicle_id, p_requested_p2, p_effective_priority,
       'pending', p_now)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('applied', 0, 'reason', 'already_applied');
  end;

  return jsonb_build_object('applied', 1, 'reason', 'applied', 'reservation_id', v_id);
end $$;

revoke all on function apply_reservation(uuid, uuid, uuid, boolean, smallint, timestamptz) from public;
grant execute on function apply_reservation(uuid, uuid, uuid, boolean, smallint, timestamptz) to service_role;
