-- Foundation 4/6 — security-definer views for the pre-confirm projections.
--
-- CLAUDE.md rule 2: before a contractor is confirmed on a slot they never see
-- the exact address, client contact, brief, shot list, crew list or emergency
-- contacts. RLS on a table cannot hide individual columns, and the coarse
-- fields a candidate may see (date, area, role, rate, gear) sit on the same
-- rows as the exact ones. So the tables stay closed to non-confirmed
-- contractors and these views expose the narrow projection instead.
--
-- Each view runs with the definer's rights (security_invoker = false) and
-- carries its own authorization in the WHERE clause. They select only the
-- permitted columns, so a wider read is not reachable through them.

-- The job board, plus a candidate's own invites and opt-ins.
-- Matrix row 1 ("Event date, area, role, rate, gear needed") and the
-- "Summary line only" cell of row 4.
create view public.job_board
with (security_invoker = false) as
select
  s.id                as slot_id,
  s.event_id,
  s.org_id,
  s.role,
  s.rate_type,
  s.rate_amount_cents,
  s.required_gear,
  s.call_time,
  s.interest_deadline,
  s.staffing_mode,
  s.status            as slot_status,
  e.title             as event_title,
  e.starts_at,
  e.ends_at,
  e.time_zone,
  -- Coarse location only. e.address, e.latitude and e.longitude are not here.
  e.area_label,
  e.status            as event_status,
  a.status            as my_assignment_status,
  a.note              as my_note,
  a.invite_expires_at,
  a.confirm_deadline,
  case
    when a.status = any (array['invited', 'interested', 'selected']::public.assignment_status[])
    then b.summary
  end                 as brief_summary
from public.slots s
join public.events e on e.id = s.event_id
left join public.assignments a
       on a.slot_id = s.id
      and a.user_id = auth.uid()
left join public.briefs b on b.event_id = e.id
where e.status <> 'draft'
  and (
    a.status = any (array['invited', 'interested', 'selected']::public.assignment_status[])
    or app.is_eligible_for_slot(s.id)
  );

comment on view public.job_board is
  'Coarse slot and event fields for contractors who are invited, opted in, or eligible for an open call. Security definer by design: it is the pre-confirm projection, and it never selects the address, client contact or brief body.';

-- Matrix row 5: a confirmed contractor sees the other crew's names, roles and
-- phone numbers — nothing else from their profiles.
create view public.event_crew
with (security_invoker = false) as
select
  a.id        as assignment_id,
  s.event_id,
  s.org_id,
  a.user_id,
  s.role,
  a.status    as assignment_status,
  p.full_name,
  p.phone
from public.assignments a
join public.slots s on s.id = a.slot_id
left join public.profiles p on p.user_id = a.user_id
where a.status = any (array[
        'confirmed', 'checked_in', 'checked_out', 'uploaded',
        'changes_requested', 'approved', 'paid'
      ]::public.assignment_status[])
  and (app.is_admin(s.org_id) or app.packet_visible(s.event_id));

comment on view public.event_crew is
  'Crew on an event: names, roles and phone numbers, for admins and for confirmed crew on that event. Security definer by design — see CLAUDE.md rule 2.';

-- Matrix row 11 keeps organizations itself owner-only (it holds Stripe and
-- settings). Producers and contractors still need the name and branding to
-- render the app, so they read them here.
create view public.organization_public
with (security_invoker = false) as
select
  o.id,
  o.name,
  o.slug,
  o.branding
from public.organizations o
where app.is_member(o.id);

comment on view public.organization_public is
  'Name, slug and branding of organizations the caller belongs to. Excludes stripe_account_id and settings, which are owner-only on the table.';

grant select on public.job_board to authenticated;
grant select on public.event_crew to authenticated;
grant select on public.organization_public to authenticated;
