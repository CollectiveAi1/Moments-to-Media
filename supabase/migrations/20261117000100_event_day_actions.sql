-- Event-day actions the screens need and the state machines leave out.
--
-- docs/ui/UI-SPEC.md asks for three things the schema could not yet do:
--
-- 1. "Confirm by 9 PM". Selecting a contractor sends a confirm request with a
--    deadline (PRD "Staffing", default 12h), and an invitation expires after a
--    window (default 24h). Neither deadline is client-writable, and the
--    transition function moves the status without setting them, so they were
--    always null. A trigger now sets both from the organization's settings,
--    and refuses a confirm that arrives after its deadline.
--
-- 2. "Check-in records location; outside the venue radius, still allow it and
--    flag it to the producer" (UI-SPEC 4.4). The coordinates columns are not
--    client-writable either, so check-in is one function: the transition plus
--    the coordinates, plus a notification when it is outside the radius.
--
-- 3. "Running late": an ETA sent to the producer (UI-SPEC 4.4). Notifications
--    have no client insert path by design, so this is a narrow function that
--    writes exactly one, for exactly the contractor's own confirmed slot.

-- ------------------------------------------------------------ deadlines

create or replace function app.assignment_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_hours    numeric;
begin
  select o.settings into v_settings from public.organizations o where o.id = new.org_id;

  if tg_op = 'INSERT' and new.status = 'invited' and new.invite_expires_at is null then
    v_hours := coalesce(nullif(v_settings ->> 'invite_window_hours', '')::numeric, 24);
    new.invite_expires_at := now() + v_hours * interval '1 hour';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'selected' then
      v_hours := coalesce(nullif(v_settings ->> 'confirm_deadline_hours', '')::numeric, 12);
      new.confirm_deadline := now() + v_hours * interval '1 hour';
    end if;

    -- A confirm after the deadline is refused here rather than left for a
    -- sweeper to expire later: the slot may already have gone to the next
    -- candidate (PRD "Staffing", selection rule).
    if new.status = 'confirmed' and old.status = 'invited'
       and old.invite_expires_at is not null and old.invite_expires_at < now() then
      raise exception 'this invitation expired at %', old.invite_expires_at
        using errcode = 'check_violation',
              hint = 'Ask the producer to invite you again.';
    end if;
    if new.status = 'confirmed' and old.status = 'selected'
       and old.confirm_deadline is not null and old.confirm_deadline < now() then
      raise exception 'the deadline to confirm passed at %', old.confirm_deadline
        using errcode = 'check_violation',
              hint = 'Ask the producer whether the slot is still yours.';
    end if;
  end if;

  return new;
end;
$$;

create trigger assignments_deadlines
  before insert or update of status on public.assignments
  for each row execute function app.assignment_deadlines();

-- ------------------------------------------------------------ check-in

create or replace function public.check_in(
  p_assignment uuid,
  p_latitude   numeric default null,
  p_longitude  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_event      public.events;
  v_distance_m numeric;
  v_outside    boolean := false;
begin
  if auth.uid() is null then
    raise exception 'check-in needs a signed-in contractor' using errcode = 'insufficient_privilege';
  end if;

  if (p_latitude is null) <> (p_longitude is null)
     or (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180))
  then
    raise exception 'location is incomplete or out of range' using errcode = 'check_violation';
  end if;

  -- Actor, state and cascade rules are the state machine's, unchanged: only
  -- the assignee, only from confirmed, only while the event is on.
  v_assignment := app.transition_assignment_internal(
    p_assignment, 'checked_in'::public.assignment_status, null, true, true);

  select e.* into v_event
  from public.events e
  join public.slots s on s.event_id = e.id
  where s.id = v_assignment.slot_id;

  if p_latitude is not null then
    update public.assignments
       set check_in_latitude = p_latitude, check_in_longitude = p_longitude
     where id = p_assignment;

    if v_event.latitude is not null then
      v_distance_m := app.miles_between(v_event.latitude, v_event.longitude, p_latitude, p_longitude) * 1609.344;
      v_outside := v_distance_m > v_event.check_in_radius_m;
    end if;
  end if;

  if v_outside then
    perform app.log_activity(
      v_assignment.org_id, 'assignment', p_assignment, 'checked_in_outside_radius',
      jsonb_build_object('distance_m', round(v_distance_m), 'radius_m', v_event.check_in_radius_m));

    insert into public.notifications (org_id, user_id, type, channels, payload)
    values (v_assignment.org_id, v_event.producer_id, 'checked_in_outside_radius', '{in_app}',
            jsonb_build_object(
              'assignment_id', p_assignment,
              'event_id', v_event.id,
              'event_title', v_event.title,
              'contractor_name', (select p.full_name from public.profiles p where p.user_id = auth.uid()),
              'distance_m', round(v_distance_m)));
  end if;

  return jsonb_build_object(
    'checked_in_at', v_assignment.checked_in_at,
    'distance_m', round(v_distance_m),
    'outside_radius', v_outside);
end;
$$;

comment on function public.check_in(uuid, numeric, numeric) is
  'Check in on a confirmed slot, recording where. Outside the event''s radius it is still allowed and the producer is notified (UI-SPEC 4.4).';

-- --------------------------------------------------------- running late

create or replace function public.report_running_late(p_assignment uuid, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_event      public.events;
  v_producer   text;
  v_name       text;
begin
  select * into v_assignment from public.assignments where id = p_assignment;

  if not found or auth.uid() is null or v_assignment.user_id <> auth.uid() then
    raise exception 'only the contractor on this slot can report running late'
      using errcode = 'insufficient_privilege';
  end if;
  if v_assignment.status <> 'confirmed' then
    raise exception 'running late is for before check-in; this slot is %', v_assignment.status
      using errcode = 'check_violation';
  end if;
  if p_minutes is null or p_minutes not between 1 and 600 then
    raise exception 'the ETA must be between 1 and 600 minutes' using errcode = 'check_violation';
  end if;

  select e.* into v_event
  from public.events e
  join public.slots s on s.event_id = e.id
  where s.id = v_assignment.slot_id;

  select p.full_name into v_producer from public.profiles p where p.user_id = v_event.producer_id;
  select p.full_name into v_name from public.profiles p where p.user_id = auth.uid();

  insert into public.notifications (org_id, user_id, type, channels, payload)
  values (v_assignment.org_id, v_event.producer_id, 'running_late', '{in_app}',
          jsonb_build_object(
            'assignment_id', p_assignment,
            'event_id', v_event.id,
            'event_title', v_event.title,
            'contractor_name', v_name,
            'eta_minutes', p_minutes));

  perform app.log_activity(
    v_assignment.org_id, 'assignment', p_assignment, 'running_late',
    jsonb_build_object('eta_minutes', p_minutes));

  return jsonb_build_object('producer_name', v_producer, 'eta_minutes', p_minutes, 'sent_at', now());
end;
$$;

comment on function public.report_running_late(uuid, integer) is
  'A confirmed contractor tells the event''s producer they will be late, with an ETA in minutes (UI-SPEC 4.4).';

revoke all on function public.check_in(uuid, numeric, numeric) from public, anon;
revoke all on function public.report_running_late(uuid, integer) from public, anon;
grant execute on function public.check_in(uuid, numeric, numeric) to authenticated;
grant execute on function public.report_running_late(uuid, integer) to authenticated;
revoke all on function app.assignment_deadlines() from public;
