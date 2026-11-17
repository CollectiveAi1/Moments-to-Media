-- Studio uploads (20261118000600, 0700): the producer delivers finished files
-- to a client's event directly; contractors cannot; the client sees them only
-- once the event's media is released; crew uploads still route as before.
-- The same checks were run against the hosted project on 2026-11-17.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.start_upload(%L, 'Final_Film.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  'NO_ERROR', 'studio · the event''s producer starts a delivery by event id');
select is((select count(*) from public.uploads where event_id = tests.id('event_a') and assignment_id is null and uploaded_by = tests.id('producer_a')), 1::bigint,
  'studio · the upload belongs to the event, not an assignment');
select ok((select storage_key like '%/studio/deliverables/Final_Film.mp4' from public.uploads where event_id = tests.id('event_a')),
  'studio · its key sits under the event''s studio folder');
select is(
  tests.error_as(tests.id('confirmed_contractor'), format($q$select public.start_upload(%L, 'x.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '42501', 'studio · a contractor cannot deliver to the client');
select is(
  tests.error_as(tests.id('owner_b'), format($q$select public.start_upload(%L, 'x.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '42501', 'studio · another organization cannot');
select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.start_studio_upload(%L, 'raw.mov', 1000, 'abc=', 'raw', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '23514', 'studio · deliveries are final edits or selects, not raw footage');
select is(
  tests.error_as(tests.id('confirmed_contractor'), format($q$select public.start_upload(%L, 'A002.mp4', 1000, 'abc=', 'raw', null, 'crc64nvme')$q$, tests.id('slot_confirmed'))),
  'NO_ERROR', 'crew · a contractor still uploads to their own slot');
select is(tests.count_as(tests.id('confirmed_contractor'), format('select 1 from public.uploads where event_id = %L', tests.id('event_a'))), 0::bigint,
  'studio · contractors do not see studio deliveries');
select is(tests.count_as(tests.id('producer_a'), format('select 1 from public.uploads where event_id = %L', tests.id('event_a'))), 1::bigint,
  'studio · the producer sees them');

-- finish the studio file and release: the client sees it
update public.uploads set status = 'completed', multipart_upload_id = 'm', verified_bytes = bytes, verified_checksum = checksum, completed_at = now()
 where event_id = tests.id('event_a');
select lives_ok(format($q$insert into public.org_invitations (org_id, role, email, invited_by, client_id) values (%L, 'client', 'dana@example.test', %L, %L)$q$,
  tests.id('org_a'), tests.id('owner_a'), tests.id('client_a')), 'client · invited');
select lives_ok($q$select tests.new_user('client_a_user', 'dana@example.test', 'Dana Client')$q$, 'client · signs in');
select is(tests.count_as(tests.id('client_a_user'), format('select * from public.client_media(%L)', tests.id('event_a'))), 0::bigint,
  'studio · the client sees nothing before release');
select is(tests.error_as(tests.id('producer_a'), format($q$select public.release_media(%L, 'Ready')$q$, tests.id('event_a'))), 'NO_ERROR',
  'studio · a finished studio file is enough to release');
select is(tests.count_as(tests.id('client_a_user'), format('select * from public.client_media(%L)', tests.id('event_a'))), 1::bigint,
  'studio · after release the client sees the delivery (crew footage is not approved, so only this)');
select is(tests.error_as(tests.id('confirmed_contractor'), format('select public.remove_studio_upload(%L)', (select id from public.uploads where event_id = tests.id('event_a')))),
  '42501', 'studio · a contractor cannot remove a delivery');
select is(tests.error_as(tests.id('producer_a'), format('select public.remove_studio_upload(%L)', (select id from public.uploads where event_id = tests.id('event_a')))),
  'NO_ERROR', 'studio · the producer removes it');
select is(tests.count_as(tests.id('client_a_user'), format('select * from public.client_media(%L)', tests.id('event_a'))), 0::bigint,
  'studio · and the client no longer sees it');

select * from finish();
rollback;
