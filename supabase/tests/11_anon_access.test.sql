-- An unauthenticated caller reaches nothing.
--
-- The regression test for 20261112001100. Supabase's default privileges hand
-- EXECUTE on every new function in `public` to anon, and the earlier
-- migrations' `revoke ... from public` did not take an explicit per-role grant
-- back. Several entry points read "no user id" as "a trusted server context",
-- which is true of service_role and false of anon, so the grant was enough to
-- let an unauthenticated caller move assignments and payouts and read any
-- upload's storage key.
--
-- Three things are asserted here, because the fix has three parts: the grant
-- is gone, the in-function guard would stop it even if the grant came back,
-- and signed-in callers and the service role are unaffected.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- The catalog side of this lives in 01_schema_conventions; what follows is
-- what an unauthenticated caller actually gets.

-- ---------------------------------------- anon is refused at every entrance
-- 42501 either way: the missing grant and the guard raise the same SQLSTATE,
-- which is the point — the caller learns nothing from the difference.

select is(
  tests.error_as_anon(
    format('select public.transition_assignment(%L, ''checked_in'')', tests.id('assign_confirmed'))),
  '42501', 'anon cannot check a contractor in');

select is(
  tests.error_as_anon(
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a'))),
  '42501', 'anon cannot move a payout');

select is(
  tests.error_as_anon(
    format('select public.transition_event(%L, ''cancelled'')', tests.id('event_a'))),
  '42501', 'anon cannot cancel an event');

select is(
  tests.error_as_anon('select public.claim_invitations()'),
  '42501', 'anon cannot claim an invitation');

select is(
  tests.error_as_anon(
    format('select public.upload_resume_plan(%L)', tests.id('upload_a'))),
  '42501', 'anon cannot read an upload''s resume plan');

select is(
  tests.error_as_anon(
    format('select public.record_upload_part(%L, 1, ''forged'')', tests.id('upload_a'))),
  '42501', 'anon cannot write a part into someone else''s upload');

select is(
  tests.error_as_anon(
    format('select public.abort_upload(%L)', tests.id('upload_a'))),
  '42501', 'anon cannot abort someone else''s upload');

select is(
  tests.error_as_anon(
    format('select public.start_upload(%L, ''X.mp4'', 1000, ''sha256:x'')', tests.id('slot_confirmed'))),
  '42501', 'anon cannot open an upload');

-- ---- and nothing moved

select is(
  (select status::text from public.assignments where id = tests.id('assign_confirmed')),
  'confirmed', 'the assignment is where it was');

select is(
  (select status::text from public.payouts where id = tests.id('payout_a')),
  'draft', 'and so is the payout');

select is(
  (select status::text from public.events where id = tests.id('event_a')),
  'staffed', 'and the event');

-- ------------------------------------------- the guard, independent of the grant
-- Anon claims presented by a role that does hold EXECUTE. If someone re-grants
-- anon in a later migration, these still fail closed.

select is(
  tests.error_with_anon_claims(
    format('select public.transition_assignment(%L, ''checked_in'')', tests.id('assign_confirmed'))),
  '42501', 'the guard refuses anon claims even with EXECUTE in hand');

select is(
  tests.error_with_anon_claims(
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a'))),
  '42501', 'on payouts too');

select is(
  tests.error_with_anon_claims('select public.claim_invitations()'),
  '42501', 'and on the invitation claim');

select is(
  tests.error_with_anon_claims(
    format('select public.upload_resume_plan(%L)', tests.id('upload_a'))),
  '42501', 'and on the upload entry points');

select is(
  tests.error_with_anon_claims(
    format('select public.record_upload_part(%L, 1, ''forged'')', tests.id('upload_a'))),
  '42501', 'including the part ledger');

-- ------------------------------------ signed-in callers are not caught by it
-- A missing row, not a refusal: the guard let them through and the function
-- did its own work. Without this, a guard that refused everyone would pass
-- every assertion above.

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_assignment(%L, ''checked_in'')', gen_random_uuid())),
  'P0002', 'a signed-in caller reaches the function and gets no_data_found');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.upload_resume_plan(%L)', gen_random_uuid())),
  'P0002', 'and so does a contractor on the upload entry points');

select is(
  tests.error_as(tests.id('owner_a'), 'select public.claim_invitations()'),
  'NO_ERROR', 'and the invitation claim still runs for a signed-in caller');

-- ----------------------------------------------- the service role is unaffected
-- PRD "Architecture and stack": Stripe webhooks and the upload backend run on
-- the service role with no JWT, which must keep counting as trusted.

select is(
  tests.error_as_service(
    format('select public.record_upload_part(%L, 1, ''etag-1'')', gen_random_uuid())),
  'P0002', 'the service role reaches the part ledger');

select is(
  tests.error_as_service(
    format('select public.transition_payout(%L, ''paid'')', gen_random_uuid())),
  'P0002', 'and the payout machine');

-- ------------------------------------------ the backend-only upload RPCs
-- 20261112001300. service_role reaches them; nobody else does, signed in or
-- not. These are the calls that declare an upload verified.

select is(
  tests.error_as_anon(
    format('select public.complete_upload(%L, 1, ''sha256:x'')', tests.id('upload_a'))),
  '42501', 'anon cannot declare an upload complete');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.complete_upload(%L, 1, ''sha256:x'')', tests.id('upload_a'))),
  '42501', 'nor can the contractor who owns the upload');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.complete_upload(%L, 1, ''sha256:x'')', tests.id('upload_a'))),
  '42501', 'nor can the organization owner');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.attach_multipart(%L, ''r2-forged'')', tests.id('upload_a'))),
  '42501', 'and a producer cannot attach a multipart upload');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.fail_upload(%L, ''forced'')', tests.id('upload_a'))),
  '42501', 'nor fail one');

-- The service role is what the Edge Functions use, and it does reach them:
-- a missing row rather than a refusal.
select is(
  tests.error_as_service(
    format('select public.attach_multipart(%L, ''r2-mpu-x'')', gen_random_uuid())),
  'P0002', 'the service role reaches attach_multipart');

select is(
  tests.error_as_service(
    format('select public.complete_upload(%L, 1, ''sha256:x'')', gen_random_uuid())),
  'P0002', 'and complete_upload');

select is(
  tests.error_as_service(
    format('select public.fail_upload(%L, ''gone'')', gen_random_uuid())),
  'P0002', 'and fail_upload');

select * from finish();
rollback;
