-- Regression tests for the 2026-11-19 security audit
-- (20261119000100 … 20261119000400). Each block names its finding.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- ------------------------------------------------- H1: demo uploads, quota
-- H1 · a demo account owns org A
do $$ begin perform tests.new_user('demo_owner', 'audit-demo@demo.moments-to-media.invalid', 'Demo Owner'); end $$;
insert into public.memberships (org_id, user_id, role, status)
values (tests.id('org_a'), tests.id('demo_owner'), 'owner', 'active');

select is(
  tests.error_as(tests.id('demo_owner'), format($q$select public.start_upload(%L, 'film.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '42501', 'H1 · a demo account cannot start a studio upload');
select is(
  tests.error_as(tests.id('demo_owner'), format($q$select public.start_studio_upload(%L, 'film.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '42501', 'H1 · nor by calling the studio function directly');
select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.start_upload(%L, 'film.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  'NO_ERROR', 'H1 · a real producer still can');

update public.organizations
   set upload_quota_bytes = (select coalesce(sum(bytes), 0) from public.uploads
                             where org_id = tests.id('org_a') and status not in ('failed', 'aborted')) + 1500
 where id = tests.id('org_a');
select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.start_upload(%L, 'small.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  'NO_ERROR', 'H1 · an upload under the quota is allowed');
select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.start_upload(%L, 'big.mp4', 1000, 'abc=', 'deliverables', null, 'crc64nvme')$q$, tests.id('event_a'))),
  '23514', 'H1 · one that would go over the quota is refused');
select is(
  tests.error_as(tests.id('owner_a'), format('update public.organizations set upload_quota_bytes = 1e15 where id = %L', tests.id('org_a'))),
  '42501', 'H1 · an owner cannot raise their own quota');

-- ------------------------------------------- M1: announcements, sign-up
-- M1 · someone signs up as a client of org A
do $$ begin perform tests.new_user('stranger_client', 'stranger@example.test', 'Stranger'); end $$;
insert into public.memberships (org_id, user_id, role, status)
values (tests.id('org_a'), tests.id('stranger_client'), 'client', 'active');

select is(tests.count_as(tests.id('stranger_client'), 'select 1 from public.announcements'), 0::bigint,
  'M1 · a client reads no crew announcements');
select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.announcements'), 1::bigint,
  'M1 · crew still do');
select is(
  tests.error_as(tests.id('stranger_client'),
    format($q$insert into public.compliance_documents (org_id, user_id, doc_type, status) values (%L, %L, 'insurance', 'pending')$q$,
           tests.id('org_a'), tests.id('stranger_client'))),
  '42501', 'M1 · a client cannot file compliance documents');

insert into public.organizations (name, slug) values ('Fresh Org', 'fresh-org-' || substr(md5(random()::text), 1, 8));
select ok((select not contractor_signup and not client_signup from public.organizations where name = 'Fresh Org'),
  'M1 · a new organization takes no sign-ups until its owner turns them on');

-- ------------------------------------------------ M2: sign-in throttle
select is(tests.error_as_anon($q$select public.record_login_failure('owner-a@example.test', '203.0.113.9')$q$), '42501',
  'M2 · a visitor cannot record failures for someone else');
select is(tests.error_as_anon($q$select public.login_wait_seconds('owner-a@example.test', '203.0.113.9')$q$), '42501',
  'M2 · nor read the count');
select is(tests.error_as(tests.id('confirmed_contractor'), $q$select public.clear_login_failures('owner-a@example.test', '203.0.113.9')$q$), '42501',
  'M2 · a signed-in user cannot clear anyone''s count');
select is(tests.error_as_service($q$select public.record_login_failure('owner-a@example.test', '203.0.113.9')$q$), 'NO_ERROR',
  'M2 · the server (service role) still can');

-- ----------------------------------------- L4: verified applicant email
-- L4 · an applicant edits their profile email to someone else's
do $$ begin perform tests.new_user('spoofer', 'real-applicant@example.test', 'Spoofer'); end $$;
insert into public.memberships (org_id, user_id, role, status)
values (tests.id('org_a'), tests.id('spoofer'), 'contractor', 'pending');
update public.profiles set email = 'owner-a@example.test' where user_id = tests.id('spoofer');

select is(
  tests.value_as(tests.id('producer_a'),
    format($q$select email from public.pending_contractors(%L) where user_id = %L$q$, tests.id('org_a'), tests.id('spoofer'))),
  'real-applicant@example.test', 'L4 · the applicant list shows the verified address');

-- ------------------------------------------- L5: same-org references
select throws_ok(
  format($q$insert into public.leads (org_id, name, email, client_id) values (%L, 'Cross', 'cross@example.test', %L)$q$, tests.id('org_a'), tests.id('client_b')),
  '23503', null, 'L5 · a lead cannot point at another organization''s client');
select throws_ok(
  format($q$insert into public.proposals (org_id, created_by, title, client_name, client_email, event_starts_at, event_ends_at, client_id)
            values (%L, %L, 'Cross', 'C', 'c@example.test', now(), now() + interval '1 hour', %L)$q$,
         tests.id('org_a'), tests.id('owner_a'), tests.id('client_b')),
  '23503', null, 'L5 · nor a proposal');
select lives_ok(
  format($q$insert into public.leads (org_id, name, email, client_id) values (%L, 'Same', 'same@example.test', %L)$q$, tests.id('org_a'), tests.id('client_a')),
  'L5 · its own client is fine');

select * from finish();
rollback;
