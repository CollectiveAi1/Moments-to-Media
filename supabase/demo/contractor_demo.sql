-- Contractor-side demo data, for one real person who is already an owner or
-- producer in the demo organization and wants to try the contractor view.
-- NOT a migration. Run with psql:  \set contractor_email 'name@example.com'
-- then \i contractor_demo.sql. board_demo_teardown.sql removes all of it
-- along with the rest of the demo organization.
--
-- It gives them, in "Moments to Media (demo data)":
--   a contractor role, gear, a home base and documents (insurance expiring);
--   an invitation to respond to (Crane & Co. holiday party, Video);
--   open calls they are eligible for (Ohio Valley Tech Summit, Riverside);
--   a staffed test shoot starting in two hours, confirmed, with a shot list,
--   brief, contacts, client contact and a deliverable;
--   a paid job from earlier in the month, for Earnings.

do $demo$
declare
  v_org  uuid;
  v_me   uuid;
  v_by   uuid;
  e      uuid;
  s      uuid;
  a      uuid;
  c      uuid;
  tz constant text := 'America/New_York';
begin
  select id into v_org from public.organizations where slug = 'mtm-demo';
  select id into v_me from auth.users where lower(email) = lower(:'contractor_email');
  select user_id into v_by from public.memberships where org_id = v_org and role = 'producer' order by created_at limit 1;
  if v_org is null or v_me is null then
    raise exception 'run board_demo.sql first, and sign in once with that address';
  end if;

  insert into public.memberships (org_id, user_id, role) values (v_org, v_me, 'contractor')
  on conflict do nothing;

  insert into public.contractor_details (user_id, skills, home_base_label, home_base_latitude, home_base_longitude, travel_radius_miles, default_rate_cents)
  values (v_me, '{photo,video,drone}', 'Columbus, OH', 39.961200, -83.000700, 60, 45000)
  on conflict (user_id) do nothing;

  insert into public.equipment (user_id, category, make, model) values
    (v_me, 'camera_body', 'Sony', 'A7 IV'), (v_me, 'lens', 'Sony', '24-70mm GM II'), (v_me, 'drone', 'DJI', 'Air 3');

  insert into public.compliance_documents (org_id, user_id, doc_type, status, expires_on) values
    (v_org, v_me, 'contractor_agreement', 'approved', null),
    (v_org, v_me, 'insurance', 'approved', current_date + 45);

  insert into public.availability (user_id, starts_on, ends_on, is_available) values
    (v_me, current_date + 10, current_date + 10, false),
    (v_me, current_date + 11, current_date + 11, false);

  -- An invitation on the Crane & Co. video slot.
  select s2.id into s from public.slots s2 join public.events e2 on e2.id = s2.event_id
  where e2.org_id = v_org and e2.title = 'Crane & Co. holiday party' and s2.role = 'Video';
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, v_me, 'invited');

  -- The test shoot.
  insert into public.clients (org_id, name) values (v_org, 'Short North Alliance') returning id into c;
  insert into public.client_contacts (org_id, client_id, name, phone, email, is_primary)
  values (v_org, c, 'Dana Reyes', '+15555550142', 'dana@short-north.invalid', true);

  insert into public.events (org_id, client_id, producer_id, title, starts_at, ends_at, time_zone,
                             area_label, venue_name, address, latitude, longitude, check_in_radius_m,
                             arrival_notes, parking_notes, dress_code, status)
  values (v_org, c, v_by, 'Short North gallery opening (your test shoot)',
          now() + interval '2 hours', now() + interval '6 hours', tz,
          'Short North, Columbus', 'Gallery Row Pavilion', '800 N High St, Columbus, OH 43215',
          39.979000, -83.003000, 300,
          'Crew entrance on the alley side. Ask for Dana at the door.',
          'Garage on Hubbard Ave; keep the ticket for validation.',
          'All black, no logos', 'staffed')
  returning id into e;

  insert into public.briefs (org_id, event_id, summary, body) values
    (v_org, e, 'Opening night: the ribbon, the artists, the room.',
     'Lead with the ribbon moment at 7. Then each artist beside their work. Then the room at its fullest. Keep flash off in the main gallery.');
  insert into public.event_contacts (org_id, event_id, kind, name, phone) values
    (v_org, e, 'on_site', 'Dana Reyes', '+15555550142'),
    (v_org, e, 'emergency', 'Pavilion security', '+15555550199');
  insert into public.shot_list_items (org_id, event_id, title, description, must_have, position) values
    (v_org, e, 'Ribbon cutting', 'Wide, then tight on the scissors', true, 1),
    (v_org, e, 'Each artist with their work', 'Eye level, available light', true, 2),
    (v_org, e, 'Room at its fullest', 'From the mezzanine', false, 3),
    (v_org, e, 'Detail: price cards and wine', null, false, 4);

  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 45000, now() + interval '90 minutes', 'filled') returning id into s;
  insert into public.deliverables (org_id, slot_id, title, spec, due_at)
  values (v_org, s, '40 edited stills', '{"format":"JPEG","count":40}', now() + interval '2 days');
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, v_me, 'confirmed');

  -- A paid job, for Earnings.
  select e2.id into e from public.events e2 where e2.org_id = v_org and e2.title = 'Grandview 5K';
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Video', 'flat', 52500, now() - interval '11 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, v_me, 'paid', now() - interval '11 days', now() - interval '11 days' + interval '4 hours')
  returning id into a;
  insert into public.payouts (org_id, assignment_id, amount_cents, status, submitted_at, approved_at, sent_at, paid_at)
  values (v_org, a, 52500, 'paid', now() - interval '9 days', now() - interval '9 days', now() - interval '8 days', now() - interval '6 days');

  raise notice 'contractor demo data added';
end;
$demo$;
