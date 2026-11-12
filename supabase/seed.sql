-- Local development seed. Runs after the migrations on `supabase db reset`.
-- Not used by the test suite — supabase/tests builds its own fixtures so that
-- each test file is independent of this file.
--
-- One organization, one client, one event mid-staffing: enough to open both
-- clients against a local stack. Statuses are written directly because this
-- file runs as the database owner; application code must use the transition
-- functions instead (CLAUDE.md rule 6).

do $seed$
declare
  v_org      uuid := '11111111-1111-4111-8111-111111111111';
  v_owner    uuid := '22222222-2222-4222-8222-222222222201';
  v_producer uuid := '22222222-2222-4222-8222-222222222202';
  v_shooter  uuid := '22222222-2222-4222-8222-222222222203';
  v_photog   uuid := '22222222-2222-4222-8222-222222222204';
  v_client   uuid := '33333333-3333-4333-8333-333333333331';
  v_event    uuid := '44444444-4444-4444-8444-444444444441';
  v_slot_v   uuid := '55555555-5555-4555-8555-555555555551';
  v_slot_p   uuid := '55555555-5555-4555-8555-555555555552';
begin
  if exists (select 1 from public.organizations where id = v_org) then
    raise notice 'seed already applied';
    return;
  end if;

  insert into public.organizations (id, name, slug, in_app_payments_enabled, settings)
  values (v_org, 'Moments to Media', 'moments-to-media', true,
          jsonb_build_object(
            'reminder_hours_before_call', jsonb_build_array(24, 2),
            'invite_window_hours', 24,
            'confirm_deadline_hours', 12,
            'payout_auto_approve_under_cents', 50000,
            'footage_retention_days', 90,
            'required_compliance_documents', jsonb_build_array('contractor_agreement', 'insurance')
          ));

  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
     'owner@moments.test', now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', v_producer, 'authenticated', 'authenticated',
     'producer@moments.test', now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', v_shooter, 'authenticated', 'authenticated',
     'shooter@moments.test', now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', v_photog, 'authenticated', 'authenticated',
     'photographer@moments.test', now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  insert into public.profiles (user_id, full_name, phone, email) values
    (v_owner, 'Avery Owner', '+15550000001', 'owner@moments.test'),
    (v_producer, 'Parker Producer', '+15550000002', 'producer@moments.test'),
    (v_shooter, 'Sam Shooter', '+15550000003', 'shooter@moments.test'),
    (v_photog, 'Pilar Photo', '+15550000004', 'photographer@moments.test');

  insert into public.memberships (org_id, user_id, role) values
    (v_org, v_owner, 'owner'),
    (v_org, v_producer, 'producer'),
    (v_org, v_shooter, 'contractor'),
    (v_org, v_photog, 'contractor');

  insert into public.contractor_details
    (user_id, skills, home_base_label, home_base_latitude, home_base_longitude,
     travel_radius_miles, default_rate_cents, stripe_payouts_enabled)
  values
    (v_shooter, '{video,drone}', 'Phoenix, AZ', 33.448400, -112.074000, 60, 60000, true),
    (v_photog, '{photo}', 'Tempe, AZ', 33.425500, -111.940000, 40, 45000, true);

  insert into public.equipment (user_id, category, make, model) values
    (v_shooter, 'camera_body', 'Sony', 'FX3'),
    (v_shooter, 'drone', 'DJI', 'Mavic 3'),
    (v_photog, 'camera_body', 'Canon', 'R5'),
    (v_photog, 'lens', 'Canon', 'RF 70-200mm');

  insert into public.compliance_documents (org_id, user_id, doc_type, status, expires_on) values
    (v_org, v_shooter, 'contractor_agreement', 'approved', null),
    (v_org, v_shooter, 'insurance', 'approved', current_date + 200),
    (v_org, v_photog, 'contractor_agreement', 'approved', null),
    (v_org, v_photog, 'insurance', 'approved', current_date + 120);

  insert into public.clients (id, org_id, name) values (v_client, v_org, 'Desert Classic Invitational');

  insert into public.client_contacts (org_id, client_id, name, phone, email, is_primary)
  values (v_org, v_client, 'Dana Reyes', '+15550000010', 'dana@desertclassic.test', true);

  insert into public.events
    (id, org_id, client_id, producer_id, title, starts_at, ends_at, time_zone,
     area_label, venue_name, address, latitude, longitude, check_in_radius_m,
     arrival_notes, parking_notes, dress_code, status)
  values
    (v_event, v_org, v_client, v_producer, 'Desert Classic — Championship Sunday',
     now() + interval '9 days', now() + interval '9 days 9 hours', 'America/Phoenix',
     'Downtown Phoenix, AZ', 'Heritage Hall', '117 N 3rd St, Phoenix, AZ 85004',
     33.448400, -112.074000, 250,
     'Crew entrance is the loading dock on 3rd. Ask for Dana.',
     'Garage on Monroe; bring the ticket to Dana for validation.',
     'All black, no logos', 'staffing');

  insert into public.briefs (org_id, event_id, summary, body) values
    (v_org, v_event, 'Trophy moment, sponsor wall, and 40 edited stills by Tuesday.',
     'Lead with the trophy presentation. Sponsor wall needs clean wide and detail. '
     'Candids of the crowd between matches. Deliver a 90-second highlight reel plus '
     '40 edited stills.');

  insert into public.event_contacts (org_id, event_id, kind, name, phone) values
    (v_org, v_event, 'on_site', 'Dana Reyes', '+15550000010'),
    (v_org, v_event, 'emergency', 'Heritage Hall Security', '+15550000911');

  insert into public.shot_list_items (org_id, event_id, title, description, must_have, position) values
    (v_org, v_event, 'Trophy presentation', 'Wide and tight, stage left', true, 1),
    (v_org, v_event, 'Sponsor wall', 'Clean wide with no crowd', true, 2),
    (v_org, v_event, 'Crowd candids', 'Between matches', false, 3);

  insert into public.slots
    (id, org_id, event_id, role, rate_type, rate_amount_cents, overtime_rule, call_time,
     required_gear, staffing_mode, interest_deadline, is_required, status)
  values
    (v_slot_v, v_org, v_event, 'Lead video', 'hourly', 9000,
     '{"after_hours": 8, "multiplier": 1.5}'::jsonb, now() + interval '9 days',
     '{camera_body}', 'direct_invite', null, true, 'inviting'),
    (v_slot_p, v_org, v_event, 'Photo', 'day', 45000, null, now() + interval '9 days',
     '{camera_body,lens}', 'open_call', now() + interval '5 days', true, 'open_call');

  insert into public.deliverables (org_id, slot_id, title, spec, due_at) values
    (v_org, v_slot_v, '90-second highlight reel',
     '{"format":"ProRes 422","resolution":"3840x2160","frame_rate":"24"}'::jsonb,
     now() + interval '12 days'),
    (v_org, v_slot_p, '40 edited stills',
     '{"format":"JPEG","resolution":"6000x4000","count":40}'::jsonb,
     now() + interval '11 days');

  -- Sam is invited to the video slot; Pilar has opted into the open call.
  insert into public.assignments (org_id, slot_id, user_id, status, invite_expires_at) values
    (v_org, v_slot_v, v_shooter, 'invited', now() + interval '1 day');

  insert into public.assignments (org_id, slot_id, user_id, status, note) values
    (v_org, v_slot_p, v_photog, 'interested', 'Available all day, can bring a second body.');

  insert into public.announcements (org_id, author_id, body, pinned) values
    (v_org, v_owner, 'Insurance certificates expiring this quarter: please re-upload.', true);

  raise notice 'seed applied: organization %, event %', v_org, v_event;
end;
$seed$;
