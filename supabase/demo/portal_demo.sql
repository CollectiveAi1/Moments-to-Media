-- Demo data for the client side, so all three demo logins have something to
-- show. Runs the app's own functions (send_proposal, accept_proposal,
-- record_client_payment) as the demo producer and an anonymous signer, so the
-- result is exactly what real use produces. Remove with portal_demo_teardown.sql.
--
-- Demo logins (passwords are set separately, never in this file):
--   admin   sam-park@demo.moments-to-media.invalid     (producer)
--   crew    maya-chen@demo.moments-to-media.invalid    (contractor)
--   client  demo-client@demo.moments-to-media.invalid  (created here)

do $$
declare
  v_org   uuid := (select id from public.organizations where slug = 'mtm-demo');
  v_prod  uuid := (select id from auth.users where email = 'sam-park@demo.moments-to-media.invalid');
  v_full  uuid; v_half uuid; v_drone uuid; v_hour uuid; v_rush uuid;
  v_p1 uuid; v_p2 uuid; v_tok text; v_res jsonb; v_addons uuid[];
  v_contract text;
begin
  v_contract := E'1. Services. Moments to Media will provide the photo and video coverage described in this proposal on the date and at the location above.\n\n2. Booking and payment. The date is reserved when this proposal is signed and the deposit is paid. The balance is due by the date on the invoice.\n\n3. Delivery. Edited media is delivered through your client portal within the time stated in your package.\n\n4. Cancellation. The deposit is non-refundable. Within 30 days of the event, the full amount is owed.\n\n5. Usage. You may use delivered media for any personal or business purpose.';

  perform set_config('request.jwt.claims', json_build_object('sub', v_prod, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.packages (org_id, name, description, price_cents, is_addon, sort_order) values
    (v_org, 'Full-day wedding film', E'Two cinematographers, up to 10 hours, 5-minute highlight film and full ceremony edit. Delivered in 4 weeks.', 420000, false, 1) returning id into v_full;
  insert into public.packages (org_id, name, description, price_cents, is_addon, sort_order) values
    (v_org, 'Half-day event coverage', E'One shooter, up to 5 hours, 60-second recap and 40 edited photos. Delivered in 2 weeks.', 180000, false, 2) returning id into v_half;
  insert into public.packages (org_id, name, description, price_cents, is_addon, sort_order) values
    (v_org, 'Drone aerials', 'Licensed drone pilot, venue and arrival aerials.', 45000, true, 3) returning id into v_drone;
  insert into public.packages (org_id, name, description, price_cents, is_addon, sort_order) values
    (v_org, 'Extra hour', 'Per shooter.', 25000, true, 4) returning id into v_hour;
  insert into public.packages (org_id, name, description, price_cents, is_addon, sort_order) values
    (v_org, 'Rush delivery', 'Highlight film in 7 days.', 60000, true, 5) returning id into v_rush;

  insert into public.leads (org_id, name, email, phone, event_type, event_date, location, package_id, message) values
    (v_org, 'Jordan Ellis', 'jordan@ellis.invalid', '614-555-0142', 'Corporate gala', current_date + 75, 'Columbus Museum of Art', v_half, 'Looking for photo and a short recap video for our annual gala, about 300 guests.'),
    (v_org, 'Priya & Sam', 'priya@demo-couple.invalid', null, 'Wedding', current_date + 160, 'Granville Inn', v_full, 'We love your films! Do you travel to Granville?');

  -- the demo client's signed booking
  insert into public.proposals (org_id, created_by, title, client_name, client_email, intro, contract_body, event_starts_at, event_ends_at, time_zone, deposit_percent, tax_rate_bp, venue_name, address)
  values (v_org, v_prod, 'Harper & Lee wedding film', 'Avery Harper', 'demo-client@demo.moments-to-media.invalid',
          E'Avery, thank you for choosing us! Here is everything for your day.', v_contract,
          (current_date + 45 + time '15:00') at time zone 'America/New_York', (current_date + 45 + time '23:00') at time zone 'America/New_York',
          'America/New_York', 30, 725, 'The Grove at Hocking Hills', '28400 Hocking Hills Rd, Logan, OH')
  returning id into v_p1;
  insert into public.proposal_items (org_id, proposal_id, package_id, name, description, price_cents) select v_org, v_p1, id, name, description, price_cents from public.packages where id = v_full;
  insert into public.proposal_items (org_id, proposal_id, package_id, name, description, price_cents, optional, selected) select v_org, v_p1, id, name, description, price_cents, true, false from public.packages where id in (v_drone, v_rush);
  v_tok := public.send_proposal(v_p1);

  -- a second proposal, sent and waiting for their signature
  insert into public.proposals (org_id, created_by, title, client_name, client_email, intro, contract_body, event_starts_at, event_ends_at, time_zone, deposit_percent, tax_rate_bp, venue_name)
  values (v_org, v_prod, 'Harper & Lee rehearsal dinner', 'Avery Harper', 'demo-client@demo.moments-to-media.invalid',
          E'Add-on quote for the night before, as discussed.', v_contract,
          (current_date + 44 + time '18:00') at time zone 'America/New_York', (current_date + 44 + time '21:00') at time zone 'America/New_York',
          'America/New_York', 50, 725, 'Inn & Spa at Cedar Falls')
  returning id into v_p2;
  insert into public.proposal_items (org_id, proposal_id, package_id, name, description, price_cents) select v_org, v_p2, id, name, description, price_cents from public.packages where id = v_half;
  insert into public.proposal_items (org_id, proposal_id, package_id, name, description, price_cents, optional, selected) select v_org, v_p2, id, name, description, price_cents, true, false from public.packages where id = v_hour;
  perform public.send_proposal(v_p2);

  v_addons := array(select id from public.proposal_items where proposal_id = v_p1 and optional and package_id = v_drone);
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v_res := public.accept_proposal(v_tok, 'Avery Harper', 'Avery Harper', v_addons);

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_prod, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_client_payment((v_res ->> 'invoice_id')::uuid, (v_res ->> 'deposit_cents')::int, 'check', 'Check #2041', current_date);
  insert into public.client_messages (org_id, client_id, author_id, from_client, body)
  values (v_org, (v_res ->> 'client_id')::uuid, v_prod, false, E'Hi Avery! Your deposit is in and your date is locked. We''ll reach out two weeks before with a shot-list questionnaire.');
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- the demo client's login (confirmed, so the portal invitation from signing is claimed)
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'demo-client@demo.moments-to-media.invalid', now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Avery Harper","password_set":true}', '', '', '', '', '', '', '', '');
