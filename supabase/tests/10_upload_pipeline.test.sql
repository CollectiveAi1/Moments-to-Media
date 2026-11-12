-- The upload pipeline: who may open an upload, the part plan the client
-- uploads against, resuming, the verification that gates completion, the
-- failure paths, connector queueing and the parts ledger's visibility.
-- PRD "Footage pipeline" and "Permissions and data visibility" row 7;
-- CLAUDE.md rules 7, 8 and 9.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- An event of producer_a's that is being shot: slot_u's contractor has
-- checked out and has footage to send, slot_u2's is only confirmed, and
-- slot_u3's has checked out with nothing to upload.
insert into tests.fixture_ids (name, id) values
  ('event_u', gen_random_uuid()),
  ('slot_u', gen_random_uuid()),
  ('slot_u2', gen_random_uuid()),
  ('slot_u3', gen_random_uuid()),
  ('assign_u', gen_random_uuid()),
  ('assign_u2', gen_random_uuid()),
  ('assign_u3', gen_random_uuid()),
  ('conn_account_u', gen_random_uuid());

insert into public.events (id, org_id, client_id, producer_id, title, starts_at, ends_at,
                           time_zone, area_label, status)
values (tests.id('event_u'), tests.id('org_a'), tests.id('client_a'), tests.id('producer_a'),
        'Upload walk', now() - interval '1 day', now() - interval '18 hours',
        'America/Phoenix', 'Tempe, AZ', 'in_progress');

insert into public.slots (id, org_id, event_id, role, rate_type, rate_amount_cents,
                          call_time, is_required, status)
values (tests.id('slot_u'), tests.id('org_a'), tests.id('event_u'), 'Lead video', 'flat', 60000,
        now() - interval '1 day', true, 'filled'),
       (tests.id('slot_u2'), tests.id('org_a'), tests.id('event_u'), 'Photo', 'flat', 40000,
        now() - interval '1 day', false, 'filled'),
       (tests.id('slot_u3'), tests.id('org_a'), tests.id('event_u'), 'Second camera', 'flat', 30000,
        now() - interval '1 day', false, 'filled');

insert into public.assignments (id, org_id, slot_id, user_id, status,
                                checked_in_at, checked_out_at)
values (tests.id('assign_u'), tests.id('org_a'), tests.id('slot_u'),
        tests.id('eligible_contractor'), 'checked_out',
        now() - interval '1 day', now() - interval '18 hours'),
       (tests.id('assign_u3'), tests.id('org_a'), tests.id('slot_u3'),
        tests.id('candidate_contractor'), 'checked_out',
        now() - interval '1 day', now() - interval '18 hours');

insert into public.assignments (id, org_id, slot_id, user_id, status)
values (tests.id('assign_u2'), tests.id('org_a'), tests.id('slot_u2'),
        tests.id('confirmed_contractor'), 'confirmed');

-- ================================================ who may open an upload
-- PRD "How an upload works", step 1: the backend checks the caller is
-- confirmed on that slot. CLAUDE.md rule 2 — the caller's own assignment,
-- not their role.

select is(
  tests.error_as(tests.id('outsider_contractor'),
    format('select public.start_upload(%L, ''X.mp4'', 1000, ''sha256:x'')', tests.id('slot_u'))),
  '42501', 'a contractor with no assignment on the slot cannot open an upload');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.start_upload(%L, ''X.mp4'', 1000, ''sha256:x'')', tests.id('slot_u'))),
  '42501', 'not even the event''s producer can open an upload against a slot they do not hold');

select is(
  tests.error_as(tests.id('contractor_b'),
    format('select public.start_upload(%L, ''X.mp4'', 1000, ''sha256:x'')', tests.id('slot_u'))),
  '42501', 'the other tenant''s contractor cannot open an upload here');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.start_upload(%L, ''X.mp4'', 1000, ''sha256:x'')', tests.id('slot_u2'))),
  '23514', 'uploads are not open before check-in');

-- ========================================================== the part plan

create temporary table plan_big (doc jsonb) on commit drop;

insert into plan_big (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''BIG001.mp4'', 53687091200, ''sha256:big-6400'')::text',
         tests.id('slot_u')))::jsonb;

select is((select doc->>'status' from plan_big), 'pending',
  'a fresh upload is pending until R2 has opened the multipart upload');

select is((select (doc->>'part_size_bytes')::bigint from plan_big), (8 * 1024 * 1024)::bigint,
  '8 MiB parts carry a 50 GB upload inside R2''s 10000-part limit');

select is((select (doc->>'part_count')::integer from plan_big), 6400,
  'a 50 GB upload is planned as 6400 parts');

select is(
  (select count(*) from public.upload_parts
    where upload_id = (select (doc->>'upload_id')::uuid from plan_big)),
  6400::bigint,
  'the ledger has a row per part before the first byte moves');

select is(
  -- sum(bigint) is numeric, so the cast is what makes is() resolve.
  (select sum(bytes)::bigint from public.upload_parts
    where upload_id = (select (doc->>'upload_id')::uuid from plan_big)),
  53687091200::bigint,
  'the planned parts add up to the declared size');

-- PRD "Footage pipeline → Folder structure".
select ok(
  (select doc->>'storage_key' from plan_big)
    like '%/desert-classic-invitational/%_upload-walk/lead-video_eli/raw/BIG001.mp4',
  'the object key is derived from client, event day, role and contractor');

select ok(
  (select doc->>'storage_key' from plan_big)
    like ((select slug from public.organizations where id = tests.id('org_a')) || '/%'),
  'and it is rooted at the organization');

-- A second upload of the same filename takes a numeric suffix rather than
-- overwriting the first.
select is(
  tests.value_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''BIG001.mp4'', 53687091200, ''sha256:big-again'')->>''storage_key''',
           tests.id('slot_u'))),
  (select replace(doc->>'storage_key', 'BIG001.mp4', 'BIG001-2.mp4') from plan_big),
  'a name collision takes a numeric suffix');

-- Both are in flight; clear them so the later guards are not reading these.
select lives_ok(
  format('select app.abort_upload(u.id, ''not started'')
            from public.uploads u
           where u.assignment_id = %L and u.status = ''pending''', tests.id('assign_u')),
  'a planned upload can be abandoned before it starts');

select is(
  (select count(*) from public.uploads
    where assignment_id = tests.id('assign_u') and status = 'aborted'),
  2::bigint, 'both planned uploads are aborted');

-- ============================================= what the client may declare
-- CLAUDE.md rule 9: the failure paths, not only the happy one.

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''Z.mp4'', 0, ''sha256:z'')', tests.id('slot_u'))),
  '23514', 'an upload of zero bytes is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''../../etc/passwd'', 1000, ''sha256:z'')',
           tests.id('slot_u'))),
  '23514', 'a filename carrying a path of its own is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''.hidden.mp4'', 1000, ''sha256:z'')', tests.id('slot_u'))),
  '23514', 'a leading dot is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''Z.mp4'', 1000, ''   '')', tests.id('slot_u'))),
  '23514', 'an upload must declare a checksum before it starts');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''Z.mp4'', 6597069766656, ''sha256:z'')',
           tests.id('slot_u'))),
  '23514', 'an object over R2''s 5 TiB limit is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''Z.mp4'', 53687091200, ''sha256:z'', ''raw'', 5242880)',
           tests.id('slot_u'))),
  '23514', 'a part size that needs more than 10000 parts is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.start_upload(%L, ''Z.mp4'', 20971520, ''sha256:z'', ''raw'', 1048576)',
           tests.id('slot_u'))),
  '23514', 'a part size under R2''s 5 MiB minimum is refused');

select is(
  (select count(*) from public.uploads where filename in ('Z.mp4', '.hidden.mp4')),
  0::bigint,
  'and none of those refusals left a row behind');

-- ====================================================== open, send, resume

create temporary table plan_small (doc jsonb) on commit drop;

insert into plan_small (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''A002.mp4'', 20971520, ''sha256:small-3'')::text',
         tests.id('slot_u')))::jsonb;

select is((select (doc->>'part_count')::integer from plan_small), 3,
  'a 20 MiB upload is three parts');

select is(
  (select bytes from public.upload_parts
    where upload_id = (select (doc->>'upload_id')::uuid from plan_small) and part_number = 3),
  4194304::bigint,
  'the last part is the remainder');

-- ---- attaching R2's multipart upload is the backend's move

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select app.attach_multipart(%L, ''r2-mpu-small'')',
           (select doc->>'upload_id' from plan_small))),
  '42501', 'a client cannot attach a multipart upload itself');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971520, ''sha256:small-3'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'an upload R2 has not opened cannot be completed');

select is(
  tests.error_as_service(format('select app.attach_multipart(%L, ''r2-mpu-small'')',
    (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'the backend attaches the multipart upload');

select is(
  (select status::text from public.uploads
    where id = (select (doc->>'upload_id')::uuid from plan_small)),
  'in_progress', 'and the upload is in flight');

-- CLAUDE.md rule 8.
select is(
  tests.error_as_service(format('select app.attach_multipart(%L, ''r2-mpu-small'')',
    (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'attaching the same multipart upload again is the same call');

select is(
  tests.error_as_service(format('select app.attach_multipart(%L, ''r2-mpu-different'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'attaching a different one is refused');

-- ---- the part ledger

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.record_upload_part(%L, 1, ''etag-1'')',
           (select doc->>'upload_id' from plan_small))),
  '42501', 'another contractor cannot report parts against this upload');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.record_upload_part(%L, 1, ''etag-1'', ''part-sha-1'')',
           (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'the contractor reports a part R2 accepted');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.record_upload_part(%L, 99, ''etag-99'')',
           (select doc->>'upload_id' from plan_small))),
  'P0002', 'a part number outside the plan is refused');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.record_upload_part(%L, 1, ''   '')',
           (select doc->>'upload_id' from plan_small))),
  '23514', 'a part without an ETag is refused');

-- A retried part lands with a new ETag, and the latest report wins.
select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.record_upload_part(%L, 1, ''etag-1-retry'', ''part-sha-1'')',
           (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'a retried part can be reported again');

select is(
  (select etag from public.upload_parts
    where upload_id = (select (doc->>'upload_id')::uuid from plan_small) and part_number = 1),
  'etag-1-retry', 'and the latest ETag is the one kept');

-- ---- resume (PRD "How an upload works", step 2)

select is(
  tests.value_as(tests.id('eligible_contractor'),
    format('select public.upload_resume_plan(%L)->>''bytes_received''',
           (select doc->>'upload_id' from plan_small))),
  '8388608', 'the resume plan counts the bytes already received');

select is(
  tests.value_as(tests.id('eligible_contractor'),
    format('select jsonb_array_length(public.upload_resume_plan(%L)->''missing'')::text',
           (select doc->>'upload_id' from plan_small))),
  '2', 'and names the parts still to send');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.upload_resume_plan(%L)',
           (select doc->>'upload_id' from plan_small))),
  '42501', 'the resume plan is not readable by another contractor');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.upload_resume_plan(%L)',
           (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'the event''s producer can read it');

-- ================================================= completion is verified
-- CLAUDE.md rule 7: the backend verifies size and checksum on completion.

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971520, ''sha256:small-3'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'an upload with parts outstanding cannot be completed');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select app.complete_upload(%L, 20971520, ''sha256:small-3'')',
           (select doc->>'upload_id' from plan_small))),
  '42501', 'a contractor cannot complete their own upload — only the backend has R2''s answer');

select is(
  tests.error_as_service(format(
    'select public.record_upload_part(%L, n, ''etag-'' || n, ''part-sha-'' || n)
       from generate_series(2, 3) as n',
    (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'the remaining parts land');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971519, ''sha256:small-3'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'a size R2 does not agree with is refused');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971520, ''sha256:tampered'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'a checksum R2 does not agree with is refused');

select is(
  (select status::text from public.uploads
    where id = (select (doc->>'upload_id')::uuid from plan_small)),
  'in_progress', 'and a refused completion leaves the upload in flight');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971520, ''sha256:small-3'')',
    (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'a verified completion is accepted');

select is(
  (select status::text from public.uploads
    where id = (select (doc->>'upload_id')::uuid from plan_small)),
  'completed', 'the upload is complete');

select isnt(
  (select completed_at from public.uploads
    where id = (select (doc->>'upload_id')::uuid from plan_small)),
  null, 'and stamped');

-- CLAUDE.md rule 8: the completion call can arrive twice.
select is(
  tests.error_as_service(format('select app.complete_upload(%L, 20971520, ''sha256:small-3'')',
    (select doc->>'upload_id' from plan_small))),
  'NO_ERROR', 'completing again with the same answer is the same call');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 999, ''sha256:other'')',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'completing again with a different answer is refused');

-- The invariant, not the code path: even the service role cannot write
-- status = completed without the verification beside it.
select is(
  tests.error_as_service(format(
    'update public.uploads set status = ''completed'', verified_bytes = null,
        verified_checksum = null where id = %L',
    (select doc->>'upload_id' from plan_small))),
  '23514', 'a completed upload cannot exist without its verification');

-- ====================================================== connectors queued
-- PRD "Footage pipeline → Connectors": copy on upload complete, for the
-- scope the organization set.

insert into public.connector_accounts (id, org_id, provider, root_folder, is_active)
values (tests.id('conn_account_u'), tests.id('org_a'), 'google_drive', '/Footage', true);

insert into public.connector_rules (org_id, connector_account_id, scope, trigger_on)
values (tests.id('org_a'), tests.id('conn_account_u'), 'raw', 'on_upload_complete');

create temporary table plan_conn (doc jsonb) on commit drop;

insert into plan_conn (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''A003.mp4'', 1048576, ''sha256:one-part'')::text',
         tests.id('slot_u')))::jsonb;

select is((select (doc->>'part_count')::integer from plan_conn), 1,
  'a file under one part is a single part, the 5 MiB floor notwithstanding');

select is(
  tests.error_as_service(format(
    'select app.attach_multipart(%L, ''r2-mpu-conn'')', (select doc->>'upload_id' from plan_conn))),
  'NO_ERROR', 'R2 opens it');

select is(
  tests.error_as_service(format('select public.record_upload_part(%L, 1, ''etag-c1'')',
    (select doc->>'upload_id' from plan_conn))),
  'NO_ERROR', 'its one part lands');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 1048576, ''sha256:one-part'')',
    (select doc->>'upload_id' from plan_conn))),
  'NO_ERROR', 'and it completes');

select is(
  (select count(*) from public.sync_jobs
    where upload_id = (select (doc->>'upload_id')::uuid from plan_conn)),
  1::bigint,
  'completing a raw upload queues the organization''s connector copy');

select is(
  (select status::text from public.sync_jobs
    where upload_id = (select (doc->>'upload_id')::uuid from plan_conn)),
  'queued', 'as a queued job for the background worker');

-- A rule that waits for approval queues nothing on upload complete.
update public.connector_rules set scope = 'approved_deliverables'
 where connector_account_id = tests.id('conn_account_u');

create temporary table plan_conn2 (doc jsonb) on commit drop;

insert into plan_conn2 (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''A004.mp4'', 1048576, ''sha256:one-part-2'')::text',
         tests.id('slot_u')))::jsonb;

select is(
  tests.error_as_service(format(
    'select app.attach_multipart(%L, ''r2-mpu-conn2'')',
    (select doc->>'upload_id' from plan_conn2))),
  'NO_ERROR', 'a second raw upload opens');

select is(
  tests.error_as_service(format('select public.record_upload_part(%L, 1, ''etag-c2'')',
    (select doc->>'upload_id' from plan_conn2))),
  'NO_ERROR', 'its part lands');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 1048576, ''sha256:one-part-2'')',
    (select doc->>'upload_id' from plan_conn2))),
  'NO_ERROR', 'and it completes');

select is(
  (select count(*) from public.sync_jobs
    where upload_id = (select (doc->>'upload_id')::uuid from plan_conn2)),
  0::bigint,
  'an approved-deliverables rule waits for approval rather than for the upload');

-- ================================================= aborting and failing

create temporary table plan_abort (doc jsonb) on commit drop;

insert into plan_abort (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''A005.mp4'', 1048576, ''sha256:abandoned'')::text',
         tests.id('slot_u')))::jsonb;

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.abort_upload(%L)', (select doc->>'upload_id' from plan_abort))),
  '42501', 'another contractor cannot abort this upload');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.abort_upload(%L, ''changed my mind'')',
           (select doc->>'upload_id' from plan_abort))),
  'NO_ERROR', 'the contractor abandons their own upload');

select is(
  (select status::text from public.uploads
    where id = (select (doc->>'upload_id')::uuid from plan_abort)),
  'aborted', 'and it is aborted');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.abort_upload(%L)', (select doc->>'upload_id' from plan_abort))),
  'NO_ERROR', 'aborting it again is the same call');

select is(
  tests.error_as_service(format('select app.complete_upload(%L, 1048576, ''sha256:abandoned'')',
    (select doc->>'upload_id' from plan_abort))),
  '23514', 'an aborted upload cannot be completed');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select app.fail_upload(%L, ''R2 refused'')',
           (select doc->>'upload_id' from plan_abort))),
  '42501', 'only the backend may fail an upload');

-- =============================================== "Mark upload complete"
-- PRD "Event lifecycle": Uploaded means every slot has marked its upload
-- complete. A slot cannot claim it while bytes are still moving.

create temporary table plan_flight (doc jsonb) on commit drop;

insert into plan_flight (doc)
select tests.value_as(tests.id('eligible_contractor'),
  format('select public.start_upload(%L, ''A006.mp4'', 1048576, ''sha256:in-flight'')::text',
         tests.id('slot_u')))::jsonb;

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_u'))),
  '23514', 'a slot cannot be marked uploaded while an upload is still in flight');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.abort_upload(%L)', (select doc->>'upload_id' from plan_flight))),
  'NO_ERROR', 'the stuck upload is abandoned');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_u'))),
  'NO_ERROR', 'and then the slot can be marked uploaded');

-- A contractor whose card went to the lead shooter is not trapped: the move
-- is allowed and the absence is recorded for the producer instead.
select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_u3'))),
  'NO_ERROR', 'a slot with nothing to upload can still mark itself uploaded');

select is(
  (select count(*) from public.activity_log
    where entity_id = tests.id('assign_u3') and action = 'uploaded_with_no_files'),
  1::bigint,
  'and the empty upload is written to the activity log');

select is(
  (select count(*) from public.activity_log
    where entity_id = tests.id('assign_u') and action = 'uploaded_with_no_files'),
  0::bigint,
  'while a slot that did upload is not flagged');

-- ====================================== the parts ledger is not public
-- PRD "Permissions and data visibility" row 7: owner all, producer own
-- events, contractor own uploads only.

select ok(
  (select count(*) from public.upload_parts
    where upload_id = (select (doc->>'upload_id')::uuid from plan_small)) = 3,
  'the small upload has its three parts on record');

select is(
  tests.count_as(tests.id('eligible_contractor'),
    format('select 1 from public.upload_parts where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  3::bigint, 'the contractor sees the parts of their own upload');

select is(
  tests.count_as(tests.id('confirmed_contractor'),
    format('select 1 from public.upload_parts where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  0::bigint, 'another contractor on the same event sees none of them');

select is(
  tests.count_as(tests.id('producer_a'),
    format('select 1 from public.upload_parts where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  3::bigint, 'the event''s producer sees them');

select is(
  tests.count_as(tests.id('producer_a2'),
    format('select 1 from public.upload_parts where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  0::bigint, 'a producer on another event does not');

select is(
  tests.count_as(tests.id('owner_a'),
    format('select 1 from public.upload_parts where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  3::bigint, 'the owner sees them');

select is(
  tests.count_as(tests.id('owner_b'), 'select 1 from public.upload_parts'),
  0::bigint, 'and the other tenant sees no part of any upload here');

select is(
  tests.rows_affected_as(tests.id('eligible_contractor'),
    format('update public.upload_parts set etag = ''forged'' where upload_id = %L',
           (select doc->>'upload_id' from plan_small))),
  -1::bigint, 'a contractor cannot rewrite a part they have already reported');

select * from finish();
rollback;
