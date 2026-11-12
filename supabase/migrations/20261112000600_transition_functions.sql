-- Foundation 6/6 — the three state machines.
--
-- CLAUDE.md rule 6: status changes go through one function per state machine,
-- each validating the move and writing activity_log. Clients have no update
-- grant on any status column, so these are the only way a status moves.
--
-- Each machine has an internal implementation in the app schema and a thin
-- public wrapper. The internal one takes p_check_actor so that a legitimate
-- system move can cascade — the first crew check-in moving the event to
-- in_progress, for instance, is performed by a contractor who has no right to
-- transition the event directly.
--
-- Actor rules, by state machine:
--   event       owner, or the producer who runs the event
--   assignment  per transition: the assignee, an admin, or the system
--   payout      producer submits, owner approves, the system sends and settles
--
-- The service role (background jobs, Stripe webhooks) has no JWT, so
-- auth.uid() is null there; that is what marks a trusted system caller. anon
-- cannot execute these functions at all — see the grants at the end.

-- ============================================================= money helper

-- Payout amount for an approved slot: flat and day rates as quoted, hourly
-- from the check-in and check-out times with the slot's overtime rule
-- (PRD "Payout", steps 1-2).
create or replace function app.compute_payout_cents(p_assignment uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate_type        public.rate_type;
  v_rate_cents       integer;
  v_overtime         jsonb;
  v_in               timestamptz;
  v_out              timestamptz;
  v_hours            numeric;
  v_after_hours      numeric;
  v_multiplier       numeric;
  v_regular_hours    numeric;
  v_overtime_hours   numeric;
begin
  select s.rate_type, s.rate_amount_cents, s.overtime_rule, a.checked_in_at, a.checked_out_at
    into v_rate_type, v_rate_cents, v_overtime, v_in, v_out
  from public.assignments a
  join public.slots s on s.id = a.slot_id
  where a.id = p_assignment;

  if not found then
    raise exception 'assignment % not found' , p_assignment using errcode = 'no_data_found';
  end if;

  if v_rate_type <> 'hourly' then
    return v_rate_cents;
  end if;

  -- Hourly with no recorded times falls back to the quoted rate rather than
  -- silently paying zero; the producer adjusts on the payout if needed.
  if v_in is null or v_out is null then
    return v_rate_cents;
  end if;

  v_hours := ceil(extract(epoch from (v_out - v_in)) / 3600.0);
  v_after_hours := nullif(v_overtime ->> 'after_hours', '')::numeric;
  v_multiplier := coalesce(nullif(v_overtime ->> 'multiplier', '')::numeric, 1.5);

  if v_after_hours is null or v_hours <= v_after_hours then
    return round(v_hours * v_rate_cents)::integer;
  end if;

  v_regular_hours := v_after_hours;
  v_overtime_hours := v_hours - v_after_hours;

  return round(v_regular_hours * v_rate_cents + v_overtime_hours * v_rate_cents * v_multiplier)::integer;
end;
$$;

-- ================================================================ the event

create or replace function app.transition_event_internal(
  p_event       uuid,
  p_to          public.event_status,
  p_reason      text,
  p_check_actor boolean
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event     public.events;
  v_from      public.event_status;
  v_allowed   boolean;
  v_blocker   text;
begin
  select * into v_event from public.events where id = p_event for update;

  if not found then
    raise exception 'event % not found', p_event using errcode = 'no_data_found';
  end if;

  v_from := v_event.status;

  if p_check_actor and not app.can_manage_event(p_event) then
    raise exception 'not permitted to transition event %', p_event
      using errcode = 'insufficient_privilege',
            hint = 'Only the organization owner or the event''s producer may move an event.';
  end if;

  v_allowed := case v_from
    when 'draft'       then p_to in ('staffing', 'cancelled')
    when 'staffing'    then p_to in ('staffed', 'cancelled')
    when 'staffed'     then p_to in ('in_progress', 'cancelled')
    when 'in_progress' then p_to = 'uploaded'
    when 'uploaded'    then p_to = 'complete'
    else false
  end;

  if not v_allowed then
    raise exception 'event % cannot move from % to %', p_event, v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Entry conditions from PRD "Status lifecycles → Event".
  if p_to = 'staffed' then
    select string_agg(s.role, ', ')
      into v_blocker
    from public.slots s
    where s.event_id = p_event
      and s.is_required
      and s.status <> 'cancelled'
      and not exists (
        select 1
        from public.assignments a
        where a.slot_id = s.id
          and a.status = any (array[
            'confirmed', 'checked_in', 'checked_out', 'uploaded',
            'changes_requested', 'approved', 'paid'
          ]::public.assignment_status[])
      );

    if v_blocker is not null then
      raise exception 'event % still has unconfirmed required slots: %', p_event, v_blocker
        using errcode = 'check_violation';
    end if;
  end if;

  if p_to = 'uploaded' then
    select string_agg(s.role, ', ')
      into v_blocker
    from public.slots s
    where s.event_id = p_event
      and s.is_required
      and s.status <> 'cancelled'
      and not exists (
        select 1
        from public.assignments a
        where a.slot_id = s.id
          and a.status = any (array[
            'uploaded', 'changes_requested', 'approved', 'paid'
          ]::public.assignment_status[])
      );

    if v_blocker is not null then
      raise exception 'event % still has slots that have not marked upload complete: %', p_event, v_blocker
        using errcode = 'check_violation';
    end if;
  end if;

  if p_to = 'complete' then
    select string_agg(d.title, ', ')
      into v_blocker
    from public.deliverables d
    join public.slots s on s.id = d.slot_id
    where s.event_id = p_event
      and s.status <> 'cancelled'
      and not app.deliverable_is_approved(d.id);

    if v_blocker is not null then
      raise exception 'event % has deliverables that are not approved: %', p_event, v_blocker
        using errcode = 'check_violation';
    end if;
  end if;

  update public.events
     set status       = p_to,
         completed_at = case when p_to = 'complete' then now() else completed_at end,
         cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end
   where id = p_event
  returning * into v_event;

  -- Cancelling releases the crew: confirmed people are cancelled, everyone who
  -- opted in is marked not selected (PRD "Status lifecycles → Event").
  -- Only 'confirmed' is cancellable in the assignment machine, and an event can
  -- only be cancelled before In Progress, so nobody has checked in yet.
  if p_to = 'cancelled' then
    perform app.transition_assignment_internal(a.id, 'cancelled'::public.assignment_status,
                                               'event cancelled', false, false)
    from public.assignments a
    join public.slots s on s.id = a.slot_id
    where s.event_id = p_event
      and a.status = 'confirmed';

    perform app.transition_assignment_internal(a.id, 'not_selected'::public.assignment_status,
                                               'event cancelled', false, false)
    from public.assignments a
    join public.slots s on s.id = a.slot_id
    where s.event_id = p_event
      and a.status = 'interested';
  end if;

  perform app.log_activity(
    v_event.org_id, 'event', p_event, 'status_change',
    jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason)
  );

  return v_event;
end;
$$;

create or replace function public.transition_event(
  p_event_id uuid,
  p_to       public.event_status,
  p_reason   text default null
)
returns public.events
language sql
security definer
set search_path = ''
as $$
  select app.transition_event_internal(p_event_id, p_to, p_reason, true);
$$;

comment on function public.transition_event(uuid, public.event_status, text) is
  'The only way an event status moves. Validates the transition and its entry conditions, cascades crew release on cancel, and writes activity_log. PRD "Status lifecycles → Event".';

-- =========================================================== the assignment

-- A deliverable counts as approved when its most recent review approves it:
-- the Uploaded ⇄ Changes requested loop can run several times
-- (PRD "Status lifecycles → Contractor on a slot").
create or replace function app.deliverable_is_approved(p_deliverable uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.decision = 'approved'
      from public.deliverable_reviews r
      where r.deliverable_id = p_deliverable
      order by r.created_at desc, r.id desc
      limit 1
    ),
    false
  );
$$;

create or replace function app.transition_assignment_internal(
  p_assignment  uuid,
  p_to          public.assignment_status,
  p_note        text,
  p_check_actor boolean,
  p_cascade     boolean
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_from       public.assignment_status;
  v_slot       public.slots;
  v_event      public.events;
  v_actor      text;
  v_allowed    boolean;
  v_blocker    text;
  v_payouts_on boolean;
  v_ready      boolean;
begin
  select * into v_assignment from public.assignments where id = p_assignment for update;

  if not found then
    raise exception 'assignment % not found', p_assignment using errcode = 'no_data_found';
  end if;

  v_from := v_assignment.status;

  select * into v_slot from public.slots where id = v_assignment.slot_id;
  select * into v_event from public.events where id = v_slot.event_id;

  v_allowed := case v_from
    when 'invited'           then p_to in ('confirmed', 'declined', 'expired')
    when 'interested'        then p_to in ('selected', 'not_selected', 'withdrawn')
    when 'selected'          then p_to in ('confirmed', 'expired')
    when 'confirmed'         then p_to in ('checked_in', 'cancelled', 'dropped')
    when 'checked_in'        then p_to = 'checked_out'
    when 'checked_out'       then p_to = 'uploaded'
    when 'uploaded'          then p_to in ('changes_requested', 'approved')
    when 'changes_requested' then p_to = 'uploaded'
    when 'approved'          then p_to = 'paid'
    else false
  end;

  if not v_allowed then
    raise exception 'assignment % cannot move from % to %', p_assignment, v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Who may make this particular move.
  v_actor := case
    when (v_from, p_to) in (
      ('invited', 'confirmed'), ('invited', 'declined'),
      ('interested', 'withdrawn'),
      ('selected', 'confirmed'),
      ('confirmed', 'checked_in'), ('confirmed', 'dropped'),
      ('checked_in', 'checked_out'),
      ('checked_out', 'uploaded'),
      ('changes_requested', 'uploaded')
    ) then 'assignee'
    when (v_from, p_to) in (
      ('interested', 'selected'), ('interested', 'not_selected'),
      ('invited', 'expired'), ('selected', 'expired'),
      ('confirmed', 'cancelled'),
      ('uploaded', 'changes_requested'), ('uploaded', 'approved')
    ) then 'admin'
    else 'system'
  end;

  if p_check_actor then
    if v_actor = 'assignee' and v_assignment.user_id <> auth.uid() then
      raise exception 'only the assigned contractor may move assignment % from % to %',
        p_assignment, v_from, p_to
        using errcode = 'insufficient_privilege';
    end if;

    if v_actor = 'admin' and not app.can_manage_event(v_event.id) then
      raise exception 'only the owner or the event''s producer may move assignment % from % to %',
        p_assignment, v_from, p_to
        using errcode = 'insufficient_privilege';
    end if;

    -- System moves: a trusted server context (no JWT) or the owner.
    if v_actor = 'system' and auth.uid() is not null and not app.is_owner(v_assignment.org_id) then
      raise exception 'assignment % cannot be moved from % to % from a client',
        p_assignment, v_from, p_to
        using errcode = 'insufficient_privilege',
              hint = 'This move is made by the platform (payout settlement) or by the owner.';
    end if;
  end if;

  -- ---- entry conditions

  if p_to = 'confirmed' then
    if v_event.status = any (array['cancelled', 'complete']::public.event_status[]) then
      raise exception 'event % is %, so assignment % cannot be confirmed',
        v_event.id, v_event.status, p_assignment
        using errcode = 'check_violation';
    end if;

    -- Only a confirm commits, and only one contractor can be committed to a
    -- slot (PRD "Staffing", step 5). The partial unique index is the backstop;
    -- this gives the caller a usable message.
    if exists (
      select 1
      from public.assignments other
      where other.slot_id = v_assignment.slot_id
        and other.id <> p_assignment
        and other.status = any (array[
          'confirmed', 'checked_in', 'checked_out', 'uploaded',
          'changes_requested', 'approved', 'paid'
        ]::public.assignment_status[])
    ) then
      raise exception 'slot % already has a committed contractor', v_assignment.slot_id
        using errcode = 'check_violation';
    end if;

    -- A contractor cannot confirm before Stripe onboarding finishes, where the
    -- organization pays in the app (PRD "Payments → Setup").
    select o.in_app_payments_enabled into v_payouts_on
    from public.organizations o
    where o.id = v_assignment.org_id;

    if v_payouts_on and not exists (
      select 1
      from public.contractor_details cd
      where cd.user_id = v_assignment.user_id
        and cd.stripe_payouts_enabled
    ) then
      raise exception 'contractor has not finished Stripe onboarding, so assignment % cannot be confirmed',
        p_assignment
        using errcode = 'check_violation';
    end if;
  end if;

  if p_to = 'checked_in' and v_event.status not in ('staffed', 'in_progress') then
    raise exception 'event % is %, so check-in is not open', v_event.id, v_event.status
      using errcode = 'check_violation';
  end if;

  if p_to = 'checked_out' and v_assignment.checked_in_at is null then
    raise exception 'assignment % has no check-in time', p_assignment
      using errcode = 'check_violation';
  end if;

  -- A slot is only approved once every deliverable on it is approved
  -- (PRD "Upload and delivery", step 6).
  if p_to = 'approved' then
    select string_agg(d.title, ', ')
      into v_blocker
    from public.deliverables d
    where d.slot_id = v_assignment.slot_id
      and not app.deliverable_is_approved(d.id);

    if v_blocker is not null then
      raise exception 'deliverables are not approved yet: %', v_blocker
        using errcode = 'check_violation';
    end if;
  end if;

  -- ---- apply

  update public.assignments
     set status         = p_to,
         note           = coalesce(p_note, note),
         checked_in_at  = case when p_to = 'checked_in' then now() else checked_in_at end,
         checked_out_at = case when p_to = 'checked_out' then now() else checked_out_at end
   where id = p_assignment
  returning * into v_assignment;

  perform app.log_activity(
    v_assignment.org_id, 'assignment', p_assignment, 'status_change',
    jsonb_build_object('from', v_from, 'to', p_to, 'note', p_note,
                       'slot_id', v_assignment.slot_id, 'event_id', v_event.id)
  );

  -- ---- side effects

  if p_to = 'confirmed' then
    update public.slots set status = 'filled' where id = v_assignment.slot_id;

    -- Everyone else who opted in is told the slot is filled; the notification
    -- fan-out reads these rows (PRD "Notifications": "Slot filled").
    if p_cascade then
      perform app.transition_assignment_internal(other.id, 'not_selected'::public.assignment_status,
                                                 'slot filled', false, false)
      from public.assignments other
      where other.slot_id = v_assignment.slot_id
        and other.id <> p_assignment
        and other.status = 'interested';

      if v_event.status = 'staffing' then
        select not exists (
          select 1
          from public.slots s
          where s.event_id = v_event.id
            and s.is_required
            and s.status <> 'cancelled'
            and not exists (
              select 1
              from public.assignments a
              where a.slot_id = s.id
                and a.status = any (array[
                  'confirmed', 'checked_in', 'checked_out', 'uploaded',
                  'changes_requested', 'approved', 'paid'
                ]::public.assignment_status[])
            )
        ) into v_ready;

        if v_ready then
          perform app.transition_event_internal(v_event.id, 'staffed'::public.event_status,
                                                'every required slot confirmed', false);
        end if;
      end if;
    end if;
  end if;

  -- The first check-in on event day moves the event to In Progress.
  if p_to = 'checked_in' and p_cascade and v_event.status = 'staffed' then
    perform app.transition_event_internal(v_event.id, 'in_progress'::public.event_status,
                                          'first crew check-in', false);
  end if;

  -- When the last required slot marks its upload complete, so does the event.
  if p_to = 'uploaded' and p_cascade and v_event.status = 'in_progress' then
    select not exists (
      select 1
      from public.slots s
      where s.event_id = v_event.id
        and s.is_required
        and s.status <> 'cancelled'
        and not exists (
          select 1
          from public.assignments a
          where a.slot_id = s.id
            and a.status = any (array[
              'uploaded', 'changes_requested', 'approved', 'paid'
            ]::public.assignment_status[])
        )
    ) into v_ready;

    if v_ready then
      perform app.transition_event_internal(v_event.id, 'uploaded'::public.event_status,
                                            'every required slot uploaded', false);
    end if;
  end if;

  -- Approval queues the payout (PRD "Payout", step 2).
  if p_to = 'approved' and p_cascade then
    insert into public.payouts (org_id, assignment_id, amount_cents, status)
    values (v_assignment.org_id, p_assignment, app.compute_payout_cents(p_assignment), 'draft')
    on conflict (assignment_id) do nothing;

    perform app.log_activity(
      v_assignment.org_id, 'payout', null, 'queued',
      jsonb_build_object('assignment_id', p_assignment)
    );
  end if;

  return v_assignment;
end;
$$;

create or replace function public.transition_assignment(
  p_assignment_id uuid,
  p_to            public.assignment_status,
  p_note          text default null
)
returns public.assignments
language sql
security definer
set search_path = ''
as $$
  select app.transition_assignment_internal(p_assignment_id, p_to, p_note, true, true);
$$;

comment on function public.transition_assignment(uuid, public.assignment_status, text) is
  'The only way an assignment status moves. Enforces who may make each move, the confirm preconditions (one committed contractor per slot, Stripe onboarding), and the cascades into slot, event and payout. PRD "Status lifecycles → Contractor on a slot".';

-- =============================================================== the payout

create or replace function app.transition_payout_internal(
  p_payout      uuid,
  p_to          public.payout_status,
  p_reason      text,
  p_check_actor boolean,
  p_cascade     boolean
)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout    public.payouts;
  v_from      public.payout_status;
  v_event     uuid;
  v_actor     text;
  v_allowed   boolean;
  v_threshold integer;
  v_total     integer;
begin
  select * into v_payout from public.payouts where id = p_payout for update;

  if not found then
    raise exception 'payout % not found', p_payout using errcode = 'no_data_found';
  end if;

  v_from := v_payout.status;
  v_event := app.assignment_event(v_payout.assignment_id);

  v_allowed := case v_from
    when 'draft'     then p_to = 'submitted'
    when 'submitted' then p_to = 'approved'
    when 'approved'  then p_to = 'sent'
    when 'sent'      then p_to in ('paid', 'failed')
    when 'paid'      then p_to = 'reversed'
    when 'failed'    then p_to = 'submitted'
    else false
  end;

  if not v_allowed then
    raise exception 'payout % cannot move from % to %', p_payout, v_from, p_to
      using errcode = 'check_violation';
  end if;

  v_actor := case
    when p_to = 'submitted' then 'admin'
    when p_to = 'approved'  then 'owner'
    else 'system'
  end;

  if p_check_actor then
    if v_actor = 'admin' and not app.can_manage_event(v_event) then
      raise exception 'only the owner or the event''s producer may submit payout %', p_payout
        using errcode = 'insufficient_privilege';
    end if;

    if v_actor = 'owner' and not app.is_owner(v_payout.org_id) then
      raise exception 'only the owner may approve payout %', p_payout
        using errcode = 'insufficient_privilege',
              hint = 'Payouts under the organization''s threshold are approved automatically on submit.';
    end if;

    if v_actor = 'system' and auth.uid() is not null and not app.is_owner(v_payout.org_id) then
      raise exception 'payout % cannot be moved from % to % from a client', p_payout, v_from, p_to
        using errcode = 'insufficient_privilege',
              hint = 'Sending and settlement are driven by Stripe webhooks.';
    end if;
  end if;

  update public.payouts
     set status         = p_to,
         submitted_at   = case when p_to = 'submitted' then now() else submitted_at end,
         approved_at    = case when p_to = 'approved' then now() else approved_at end,
         approved_by    = case when p_to = 'approved' then coalesce(auth.uid(), approved_by) else approved_by end,
         sent_at        = case when p_to = 'sent' then now() else sent_at end,
         paid_at        = case when p_to = 'paid' then now() else paid_at end,
         failure_reason = case when p_to in ('failed', 'reversed') then p_reason else failure_reason end
   where id = p_payout
  returning * into v_payout;

  perform app.log_activity(
    v_payout.org_id, 'payout', p_payout, 'status_change',
    jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason,
                       'amount_cents', v_payout.amount_cents)
  );

  -- Auto-approval under the owner's threshold (PRD "Payout", step 3).
  if p_to = 'submitted' and p_cascade then
    select coalesce(nullif(o.settings ->> 'payout_auto_approve_under_cents', '')::integer, 0)
      into v_threshold
    from public.organizations o
    where o.id = v_payout.org_id;

    v_total := v_payout.amount_cents + coalesce((
      select sum((adj ->> 'amount_cents')::integer)
      from jsonb_array_elements(v_payout.adjustments) as adj
    ), 0);

    if v_threshold > 0 and v_total <= v_threshold then
      v_payout := app.transition_payout_internal(
        p_payout, 'approved'::public.payout_status,
        'under the organization''s auto-approval threshold', false, true
      );
    end if;
  end if;

  -- Settlement closes the assignment.
  if p_to = 'paid' and p_cascade then
    perform app.transition_assignment_internal(
      v_payout.assignment_id, 'paid'::public.assignment_status, 'payout settled', false, false
    )
    where exists (
      select 1
      from public.assignments a
      where a.id = v_payout.assignment_id
        and a.status = 'approved'
    );
  end if;

  return v_payout;
end;
$$;

create or replace function public.transition_payout(
  p_payout_id uuid,
  p_to        public.payout_status,
  p_reason    text default null
)
returns public.payouts
language sql
security definer
set search_path = ''
as $$
  select app.transition_payout_internal(p_payout_id, p_to, p_reason, true, true);
$$;

comment on function public.transition_payout(uuid, public.payout_status, text) is
  'The only way a payout status moves. Producer submits, owner approves (or the threshold does), the platform sends and Stripe webhooks settle. PRD "Payments → Payout states".';

-- ===================================================================== grants
-- anon can reach none of these: every client signs in first.

revoke all on function public.transition_event(uuid, public.event_status, text) from public;
revoke all on function public.transition_assignment(uuid, public.assignment_status, text) from public;
revoke all on function public.transition_payout(uuid, public.payout_status, text) from public;

grant execute on function public.transition_event(uuid, public.event_status, text)
  to authenticated, service_role;
grant execute on function public.transition_assignment(uuid, public.assignment_status, text)
  to authenticated, service_role;
grant execute on function public.transition_payout(uuid, public.payout_status, text)
  to authenticated, service_role;

-- The internals are not part of the API surface.
revoke all on function app.transition_event_internal(uuid, public.event_status, text, boolean) from public;
revoke all on function app.transition_assignment_internal(uuid, public.assignment_status, text, boolean, boolean) from public;
revoke all on function app.transition_payout_internal(uuid, public.payout_status, text, boolean, boolean) from public;
grant execute on function app.transition_event_internal(uuid, public.event_status, text, boolean) to service_role;
grant execute on function app.transition_assignment_internal(uuid, public.assignment_status, text, boolean, boolean) to service_role;
grant execute on function app.transition_payout_internal(uuid, public.payout_status, text, boolean, boolean) to service_role;

-- The two internal calculators are not callable from a client either:
-- deliverable_is_approved would otherwise answer questions about rows the
-- caller cannot read.
revoke all on function app.compute_payout_cents(uuid) from public;
revoke all on function app.deliverable_is_approved(uuid) from public;
grant execute on function app.compute_payout_cents(uuid) to service_role;
grant execute on function app.deliverable_is_approved(uuid) to service_role;
