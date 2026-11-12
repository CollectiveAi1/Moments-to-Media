-- Foundation 3/6 — access predicates used by RLS policies and transitions.
--
-- Every function here is SECURITY DEFINER with a pinned empty search_path:
--   * DEFINER so a policy on memberships can ask "is this user a member?"
--     without re-entering its own policy (infinite recursion otherwise);
--   * empty search_path so nothing resolves through a caller-controlled path —
--     each object is schema-qualified.
--
-- PRD "Permissions and data visibility" is the specification these encode.

-- -------------------------------------------------------------- membership

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function app.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app.has_role(p_org uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create or replace function app.is_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(p_org, array['owner']::public.org_role[]);
$$;

-- Owner or producer: the two roles the matrix calls admins.
create or replace function app.is_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(p_org, array['owner', 'producer']::public.org_role[]);
$$;

-- An admin of any organization this person belongs to. Gates reads of
-- per-user tables (profiles, equipment, availability), which have no org_id.
create or replace function app.shares_org_as_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.status = 'active'
      and app.is_admin(m.org_id)
  );
$$;

-- --------------------------------------------------------------- the event

-- Write access to one event: the owner, or the producer who runs it
-- (PRD "Users and roles": producers "create and staff events they own").
create or replace function app.can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event
      and (
        app.is_owner(e.org_id)
        or (app.has_role(e.org_id, array['producer']::public.org_role[]) and e.producer_id = auth.uid())
      )
  );
$$;

-- Footage and payouts: owner sees all, a producer only their own events.
create or replace function app.can_see_event_money_and_footage(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event
      and (
        app.is_owner(e.org_id)
        or (app.has_role(e.org_id, array['producer']::public.org_role[]) and e.producer_id = auth.uid())
      )
  );
$$;

-- ------------------------------------------------------ standing on a slot

-- Confirmed or anything downstream of it: the packet is unlocked.
create or replace function app.has_confirmed_assignment(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.slots s on s.id = a.slot_id
    where s.event_id = p_event
      and a.user_id = auth.uid()
      and a.status = any (array[
        'confirmed', 'checked_in', 'checked_out', 'uploaded',
        'changes_requested', 'approved', 'paid'
      ]::public.assignment_status[])
  );
$$;

-- Invited, opted in, or selected but not yet confirmed.
create or replace function app.has_candidate_assignment(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.slots s on s.id = a.slot_id
    where s.event_id = p_event
      and a.user_id = auth.uid()
      and a.status = any (array['invited', 'interested', 'selected']::public.assignment_status[])
  );
$$;

-- The packet (address, client contact, brief, shot list, crew, emergency
-- contacts) is readable while confirmed, and for 7 days after the event
-- completes (PRD "Permissions and data visibility").
create or replace function app.packet_visible(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_confirmed_assignment(p_event)
     and exists (
       select 1
       from public.events e
       where e.id = p_event
         and (e.completed_at is null or e.completed_at > now() - interval '7 days')
     );
$$;

create or replace function app.owns_assignment(p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    where a.id = p_assignment
      and a.user_id = auth.uid()
  );
$$;

create or replace function app.has_assignment_on_slot(p_slot uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    where a.slot_id = p_slot
      and a.user_id = auth.uid()
  );
$$;

create or replace function app.assignment_event(p_assignment uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.event_id
  from public.assignments a
  join public.slots s on s.id = a.slot_id
  where a.id = p_assignment;
$$;

-- ---------------------------------------------- open-call eligibility parts

-- Great-circle distance in miles. Plain arithmetic, no PostGIS.
create or replace function app.miles_between(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns double precision
language sql
immutable
as $$
  select 3958.7613 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

-- Inside the contractor's coverage area. A contractor with no home base set
-- is not eligible; an event with no pin cannot exclude anyone.
create or replace function app.within_travel_radius(p_user uuid, p_lat numeric, p_lng numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_lat is null or p_lng is null then true
    else exists (
      select 1
      from public.contractor_details cd
      where cd.user_id = p_user
        and cd.home_base_latitude is not null
        and app.miles_between(cd.home_base_latitude, cd.home_base_longitude, p_lat, p_lng)
            <= cd.travel_radius_miles
    )
  end;
$$;

-- Owns at least one item in every required equipment category.
create or replace function app.gear_covered(p_user uuid, p_required text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from unnest(coalesce(p_required, '{}'::text[])) as required(category)
    where not exists (
      select 1
      from public.equipment e
      where e.user_id = p_user
        and e.category::text = required.category
    )
  );
$$;

-- Every compliance document the organization requires is approved and unexpired.
create or replace function app.compliance_complete(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.organizations o
    cross join lateral jsonb_array_elements_text(
      coalesce(o.settings -> 'required_compliance_documents', '[]'::jsonb)
    ) as required(doc_type)
    where o.id = p_org
      and not exists (
        select 1
        from public.compliance_documents cd
        where cd.org_id = p_org
          and cd.user_id = p_user
          and cd.doc_type = required.doc_type
          and cd.status = 'approved'
          and (cd.expires_on is null or cd.expires_on >= current_date)
      )
  );
$$;

-- The job board test: an open call, still open, that this contractor matches
-- on area, gear and compliance (PRD "Staffing", step 2.2).
create or replace function app.is_eligible_for_slot(p_slot uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.slots s
    join public.events e on e.id = s.event_id
    where s.id = p_slot
      and s.staffing_mode = 'open_call'
      and s.status = 'open_call'
      and e.status = any (array['staffing', 'staffed']::public.event_status[])
      and (s.interest_deadline is null or s.interest_deadline > now())
      and app.has_role(s.org_id, array['contractor']::public.org_role[])
      and app.compliance_complete(s.org_id, auth.uid())
      and app.gear_covered(auth.uid(), s.required_gear)
      and app.within_travel_radius(auth.uid(), e.latitude, e.longitude)
  );
$$;

-- --------------------------------------------------------------- audit trail

create or replace function app.log_activity(
  p_org uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_change jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.activity_log (org_id, actor_id, entity_type, entity_id, action, change)
  values (p_org, auth.uid(), p_entity_type, p_entity_id, p_action, coalesce(p_change, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

-- Helpers are called from policies, so authenticated must be able to execute
-- them; nothing else in the app schema is reachable (it is not an API schema).
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- Appended: the event a slot belongs to. Policies on slot-children
-- (deliverables, …) need it, and resolving it through a definer function
-- keeps the policy from re-entering slots' own RLS.
create or replace function app.slot_event(p_slot uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.event_id from public.slots s where s.id = p_slot;
$$;

grant execute on function app.slot_event(uuid) to authenticated, service_role;
