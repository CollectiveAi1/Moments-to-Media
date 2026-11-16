-- Demo data for the Operations board. NOT a migration and NOT the local seed.
--
-- One organization, "Moments to Media (demo data)", holding the same twelve
-- events the approved prototype draws (docs/ui/prototype/AdminBoard.dc.html),
-- so the built board can be compared with the designed one side by side.
-- Everything hangs off that one organization: board_demo_teardown.sql removes
-- all of it and touches nothing else.
--
-- The people are fictional and their addresses end in .invalid, a reserved
-- top-level domain that can never receive mail, so nothing here can email or
-- text a real person. Statuses are written directly because this runs as the
-- database owner; application code must use the transition functions
-- (CLAUDE.md rule 6). Dates are relative to now(), so the board always shows
-- one event tonight and a selection due this evening.

do $demo$
declare
  v_org uuid;
  tz constant text := 'America/New_York';
  -- people
  sam uuid; ari uuid;
  luis uuid; jordan uuid; kim uuid; maya uuid; dev uuid; rosa uuid; tom uuid; nia uuid;
  -- scratch
  e uuid; s uuid; s2 uuid; s3 uuid; a uuid; a2 uuid; i integer; shot uuid;
  shots uuid[];
begin
  if exists (select 1 from public.organizations where slug = 'mtm-demo') then
    raise notice 'demo data is already there; run board_demo_teardown.sql first to rebuild it';
    return;
  end if;

  insert into public.organizations (name, slug)
  values ('Moments to Media (demo data)', 'mtm-demo')
  returning id into v_org;

  -- ---------------------------------------------------------------- people
  with made as (
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
           'authenticated', p.handle || '@demo.moments-to-media.invalid', now(), now(), now(),
           '{"provider":"email","providers":["email"]}', '{}'
    from (values ('sam-park'), ('ari-cole'), ('luis-ortega'), ('jordan-lee'), ('kim-tran'),
                 ('maya-chen'), ('dev-patel'), ('rosa-alvarez'), ('tom-becker'), ('nia-brooks')
         ) as p(handle)
    returning id, email
  )
  select
    max(id::text) filter (where email like 'sam-park@%')::uuid,
    max(id::text) filter (where email like 'ari-cole@%')::uuid,
    max(id::text) filter (where email like 'luis-ortega@%')::uuid,
    max(id::text) filter (where email like 'jordan-lee@%')::uuid,
    max(id::text) filter (where email like 'kim-tran@%')::uuid,
    max(id::text) filter (where email like 'maya-chen@%')::uuid,
    max(id::text) filter (where email like 'dev-patel@%')::uuid,
    max(id::text) filter (where email like 'rosa-alvarez@%')::uuid,
    max(id::text) filter (where email like 'tom-becker@%')::uuid,
    max(id::text) filter (where email like 'nia-brooks@%')::uuid
  into sam, ari, luis, jordan, kim, maya, dev, rosa, tom, nia
  from made;

  -- app.handle_new_user() made a profile for each; give them their names.
  insert into public.profiles (user_id, full_name) values
    (sam, 'Sam Park'), (ari, 'Ari Cole'), (luis, 'Luis Ortega'), (jordan, 'Jordan Lee'),
    (kim, 'Kim Tran'), (maya, 'Maya Chen'), (dev, 'Dev Patel'), (rosa, 'Rosa Alvarez'),
    (tom, 'Tom Becker'), (nia, 'Nia Brooks')
  on conflict (user_id) do update set full_name = excluded.full_name;

  insert into public.memberships (org_id, user_id, role) values
    (v_org, sam, 'producer'), (v_org, ari, 'producer'),
    (v_org, luis, 'contractor'), (v_org, jordan, 'contractor'), (v_org, kim, 'contractor'),
    (v_org, maya, 'contractor'), (v_org, dev, 'contractor'), (v_org, rosa, 'contractor'),
    (v_org, tom, 'contractor'), (v_org, nia, 'contractor');

  -- ------------------------------------------------------------------ draft
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, ari, 'Lakeside Clinic open house',
          now() + interval '24 days', now() + interval '24 days 4 hours', tz, 'draft')
  returning id into e;
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Lead video', 'flat', 60000, now() + interval '24 days', 'draft'),
         (v_org, e, 'Photo', 'flat', 45000, now() + interval '24 days', 'draft'),
         (v_org, e, 'Second video', 'flat', 40000, now() + interval '24 days', 'draft');
  -- no brief: the card should say so

  -- --------------------------------------------------------------- staffing
  -- Ohio Valley Tech Summit: 1 of 3 confirmed, 4 waiting on the open call.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Ohio Valley Tech Summit',
          now() + interval '5 days', now() + interval '5 days 8 hours', tz, 'staffing')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Keynote, expo floor, sponsor wall.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                            staffing_mode, interest_deadline, status)
  values (v_org, e, 'Lead video', 'day', 90000, now() + interval '5 days', 'open_call',
          now() + interval '2 days', 'open_call') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values
    (v_org, s, jordan, 'interested'), (v_org, s, dev, 'interested'),
    (v_org, s, tom, 'interested'), (v_org, s, nia, 'interested');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'day', 55000, now() + interval '5 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, maya, 'confirmed');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Second video', 'day', 60000, now() + interval '5 days', 'inviting') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, invite_expires_at)
  values (v_org, s, rosa, 'invited', now() + interval '20 hours');

  -- Northline Bank gala: 2 of 3 confirmed, Jordan selected and not yet confirmed.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Northline Bank gala',
          now() + interval '9 days', now() + interval '9 days 6 hours', tz, 'staffing')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Black tie. Step-and-repeat, awards, candids.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Lead video', 'flat', 85000, now() + interval '9 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, dev, 'confirmed');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 60000, now() + interval '9 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, maya, 'confirmed');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                            staffing_mode, status)
  values (v_org, e, 'Second video', 'flat', 50000, now() + interval '9 days', 'open_call', 'open_call')
  returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, confirm_deadline) values
    (v_org, s, jordan, 'selected', now() + interval '6 hours');
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, tom, 'interested');

  -- Crane & Co. holiday party: nobody confirmed, two people waiting.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, ari, 'Crane & Co. holiday party',
          now() + interval '18 days', now() + interval '18 days 5 hours', tz, 'staffing')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Toast, band, team photo.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                            staffing_mode, status)
  values (v_org, e, 'Photo', 'flat', 50000, now() + interval '18 days', 'open_call', 'open_call')
  returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values
    (v_org, s, nia, 'interested'), (v_org, s, rosa, 'interested');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                            staffing_mode, status)
  values (v_org, e, 'Video', 'flat', 65000, now() + interval '18 days', 'open_call', 'open_call');

  -- Riverside ribbon cutting: an open call nobody has answered.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Riverside ribbon cutting',
          now() + interval '19 days', now() + interval '19 days 2 hours', tz, 'staffing')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Aerials of the new span, ribbon moment.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                            staffing_mode, required_gear, status)
  values (v_org, e, 'Drone', 'flat', 70000, now() + interval '19 days', 'open_call', '{drone}', 'open_call');

  -- ---------------------------------------------------------------- staffed
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, ari, 'Mercer Foundation luncheon',
          now() + interval '7 days', now() + interval '7 days 3 hours', tz, 'staffed')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Speakers and donor portraits.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 50000, now() + interval '7 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, rosa, 'confirmed');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Video', 'flat', 65000, now() + interval '7 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s, tom, 'confirmed');

  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Westbrook HS senior night',
          now() + interval '15 days', now() + interval '15 days 4 hours', tz, 'staffed')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Walk-outs, families, final whistle.');
  for i in 1..3 loop
    insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
    values (v_org, e, (array['Lead video', 'Photo', 'Second video'])[i], 'flat', 50000,
            now() + interval '15 days', 'filled') returning id into s;
    insert into public.assignments (org_id, slot_id, user_id, status)
    values (v_org, s, (array[dev, nia, kim])[i], 'confirmed');
  end loop;

  -- ------------------------------------------------------------ in progress
  -- Harbor & Pine launch: call time was 45 minutes ago. Two are on site; Luis
  -- is confirmed and has not checked in. Four of ten shots are captured.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Harbor & Pine launch',
          now() - interval '15 minutes', now() + interval '4 hours', tz, 'in_progress')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Product reveal, founder remarks, room energy.');
  shots := '{}';
  for i in 1..10 loop
    insert into public.shot_list_items (org_id, event_id, title, must_have, position)
    values (v_org, e, (array['Product reveal', 'Founder remarks', 'Wide of the room', 'Step-and-repeat',
                             'Bar detail', 'Guest candids', 'Signage', 'Product close-ups',
                             'Team photo', 'Exit shot'])[i], i <= 5, i)
    returning id into shot;
    shots := shots || shot;
  end loop;
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Lead video', 'flat', 80000, now() - interval '45 minutes', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at)
  values (v_org, s, maya, 'checked_in', now() - interval '50 minutes') returning id into a;
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 55000, now() - interval '45 minutes', 'filled') returning id into s2;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at)
  values (v_org, s2, rosa, 'checked_in', now() - interval '40 minutes') returning id into a2;
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Second video', 'flat', 50000, now() - interval '45 minutes', 'filled') returning id into s3;
  insert into public.assignments (org_id, slot_id, user_id, status) values (v_org, s3, luis, 'confirmed');
  insert into public.shot_checks (org_id, shot_list_item_id, assignment_id, outcome) values
    (v_org, shots[1], a, 'captured'), (v_org, shots[2], a, 'captured'),
    (v_org, shots[3], a2, 'captured'), (v_org, shots[4], a2, 'captured');

  -- --------------------------------------------------------------- uploaded
  -- Riverside 10K: both in, the photo set is waiting for review.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, ari, 'Riverside 10K',
          now() - interval '4 days', now() - interval '4 days' + interval '5 hours', tz, 'uploaded')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Start line, finishers, sponsor arch.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 50000, now() - interval '4 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, nia, 'uploaded', now() - interval '4 days', now() - interval '4 days' + interval '5 hours');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Video', 'flat', 65000, now() - interval '4 days', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, tom, 'approved', now() - interval '4 days', now() - interval '4 days' + interval '5 hours');

  -- Westside Expo: one of three in, and Kim's was due this morning.
  insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone, status)
  values (v_org, sam, 'Westside Expo',
          now() - interval '1 day', now() - interval '1 day' + interval '8 hours', tz, 'uploaded')
  returning id into e;
  insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Booth coverage and keynote.');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Photo', 'flat', 50000, now() - interval '1 day', 'filled') returning id into s;
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, dev, 'approved', now() - interval '1 day', now() - interval '16 hours');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Lead video', 'flat', 80000, now() - interval '1 day', 'filled') returning id into s;
  insert into public.deliverables (org_id, slot_id, title, due_at)
  values (v_org, s, 'Raw footage', now() - interval '6 hours');
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, kim, 'checked_out', now() - interval '1 day', now() - interval '16 hours');
  insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
  values (v_org, e, 'Second video', 'flat', 50000, now() - interval '1 day', 'filled') returning id into s;
  insert into public.deliverables (org_id, slot_id, title, due_at)
  values (v_org, s, 'Raw footage', now() + interval '18 hours');
  insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
  values (v_org, s, jordan, 'checked_out', now() - interval '1 day', now() - interval '16 hours');

  -- --------------------------------------------------------------- complete
  for i in 1..2 loop
    insert into public.events (org_id, producer_id, title, starts_at, ends_at, time_zone,
                               status, completed_at)
    values (v_org, (array[ari, sam])[i], (array['Short North gallery hop', 'Grandview 5K'])[i],
            now() - ((array[7, 11])[i] || ' days')::interval,
            now() - ((array[7, 11])[i] || ' days')::interval + interval '4 hours',
            tz, 'complete', now() - ((array[5, 9])[i] || ' days')::interval)
    returning id into e;
    insert into public.briefs (org_id, event_id, summary) values (v_org, e, 'Delivered and paid.');
    insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time, status)
    values (v_org, e, 'Photo', 'flat', 50000, now() - ((array[7, 11])[i] || ' days')::interval, 'filled')
    returning id into s;
    insert into public.assignments (org_id, slot_id, user_id, status, checked_in_at, checked_out_at)
    values (v_org, s, (array[maya, rosa])[i], 'paid',
            now() - ((array[7, 11])[i] || ' days')::interval,
            now() - ((array[7, 11])[i] || ' days')::interval + interval '4 hours');
  end loop;

  raise notice 'demo organization % created with 12 events', v_org;
end;
$demo$;
