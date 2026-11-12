-- Auth: profile bootstrap, invitations and the org_roles claim.
-- CLAUDE.md "Build order" Phase 1; PRD "Users and roles", "Architecture and
-- stack" (passwordless sign-in) and "Risks" (invite by SMS link).

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- ===================================================== profile bootstrap

insert into tests.fixture_ids (name, id) values
  ('bare_user', gen_random_uuid()),
  ('named_user', gen_random_uuid());

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', tests.id('bare_user'),
        'authenticated', 'authenticated', 'Casey.New@Example.Test', now(), now(),
        '{}'::jsonb, '{}'::jsonb),
       ('00000000-0000-0000-0000-000000000000', tests.id('named_user'),
        'authenticated', 'authenticated', 'given@example.test', now(), now(),
        '{}'::jsonb, '{"full_name": "Given Name"}'::jsonb);

select is(
  (select count(*) from public.profiles where user_id = tests.id('bare_user')),
  1::bigint, 'signing up creates a profile');

select is(
  (select full_name from public.profiles where user_id = tests.id('bare_user')),
  'Casey.New', 'with no name on the sign-up, it falls back to the email local part');

select is(
  (select full_name from public.profiles where user_id = tests.id('named_user')),
  'Given Name', 'a name in the sign-up metadata is kept');

select is(
  (select email from public.profiles where user_id = tests.id('named_user')),
  'given@example.test', 'and the email comes across');

-- ================================================= who may invite whom
-- PRD "Users and roles": the owner manages admins; a producer staffs events.

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''contractor'', ''new-shooter@example.test'', %L)',
           tests.id('org_a'), tests.id('producer_a'))),
  'NO_ERROR', 'a producer invites a contractor');

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''producer'', ''new-producer@example.test'', %L)',
           tests.id('org_a'), tests.id('producer_a'))),
  '42501', 'a producer cannot invite another producer');

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''owner'', ''new-owner@example.test'', %L)',
           tests.id('org_a'), tests.id('producer_a'))),
  '42501', 'nor an owner');

select is(
  tests.error_as(tests.id('owner_a'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''producer'', ''new-producer@example.test'', %L)',
           tests.id('org_a'), tests.id('owner_a'))),
  'NO_ERROR', 'the owner invites a producer');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''contractor'', ''friend@example.test'', %L)',
           tests.id('org_a'), tests.id('confirmed_contractor'))),
  '42501', 'a contractor invites nobody');

select is(
  tests.error_as(tests.id('owner_b'),
    format('insert into public.org_invitations (org_id, role, email, invited_by)
            values (%L, ''contractor'', ''poach@example.test'', %L)',
           tests.id('org_a'), tests.id('owner_b'))),
  '42501', 'and nobody invites into another tenant''s organization');

select is(
  tests.count_as(tests.id('owner_b'), 'select 1 from public.org_invitations'),
  0::bigint, 'invitations are invisible across tenants');

select isnt(
  tests.error_as(tests.id('producer_a'),
    format('update public.org_invitations set status = ''accepted''
             where org_id = %L and email = ''new-shooter@example.test''', tests.id('org_a'))),
  'NO_ERROR', 'an admin cannot mark an invitation accepted by hand');

select is(
  (select status::text from public.org_invitations
    where org_id = tests.id('org_a') and email = 'new-shooter@example.test'),
  'pending', 'and it stays pending');

-- ========================================== claiming on verified contact

insert into tests.fixture_ids (name, id) values ('invitee', gen_random_uuid());

-- Signs up unverified: the magic link has not been followed yet.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', tests.id('invitee'),
        'authenticated', 'authenticated', 'new-shooter@example.test', now(), now(),
        '{}'::jsonb, '{}'::jsonb);

select is(
  (select count(*) from public.memberships where user_id = tests.id('invitee')),
  0::bigint, 'an unverified sign-up claims nothing');

update auth.users set email_confirmed_at = now() where id = tests.id('invitee');

select is(
  (select count(*) from public.memberships where user_id = tests.id('invitee')),
  1::bigint, 'following the link claims the invitation');

select is(
  (select role::text from public.memberships where user_id = tests.id('invitee')),
  'contractor', 'with the role the producer invited them as');

select is(
  (select status::text from public.org_invitations
    where org_id = tests.id('org_a') and email = 'new-shooter@example.test'),
  'accepted', 'and the invitation is marked accepted');

select is(
  (select count(*) from public.activity_log
    where action = 'invitation_accepted' and entity_id = tests.id('invitee')),
  1::bigint, 'the acceptance reaches the activity log');

-- Claiming again changes nothing.
select is(
  tests.value_as(tests.id('invitee'), 'select public.claim_invitations()::text'),
  '0', 'claiming a second time accepts nothing further');

select is(
  (select count(*) from public.memberships where user_id = tests.id('invitee')),
  1::bigint, 'and leaves one membership');

-- ======================================= invitations that must not claim

insert into tests.fixture_ids (name, id) values
  ('expired_invitee', gen_random_uuid()),
  ('revoked_invitee', gen_random_uuid());

insert into public.org_invitations (org_id, role, email, invited_by, expires_at)
values (tests.id('org_a'), 'contractor', 'too-late@example.test',
        tests.id('producer_a'), now() - interval '1 day');

insert into public.org_invitations (org_id, role, email, invited_by, status)
values (tests.id('org_a'), 'contractor', 'changed-our-mind@example.test',
        tests.id('producer_a'), 'revoked');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', tests.id('expired_invitee'),
        'authenticated', 'authenticated', 'too-late@example.test', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb),
       ('00000000-0000-0000-0000-000000000000', tests.id('revoked_invitee'),
        'authenticated', 'authenticated', 'changed-our-mind@example.test', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb);

select is(
  (select count(*) from public.memberships where user_id = tests.id('expired_invitee')),
  0::bigint, 'an expired invitation does not let anyone in');

select is(
  (select count(*) from public.memberships where user_id = tests.id('revoked_invitee')),
  0::bigint, 'nor a revoked one');

select is(
  (select count(*) from public.memberships where user_id = tests.id('bare_user')),
  0::bigint, 'and signing up with an uninvited address joins nothing');

-- ============================== one login, several organizations (PRD)

insert into public.org_invitations (org_id, role, email, invited_by)
values (tests.id('org_b'), 'contractor',
        (select email from auth.users where id = tests.id('confirmed_contractor')),
        tests.id('owner_b'));

select is(
  tests.value_as(tests.id('confirmed_contractor'), 'select public.claim_invitations()::text'),
  '1', 'an existing login claims an invitation to a second organization');

select is(
  (select count(*) from public.memberships where user_id = tests.id('confirmed_contractor')),
  2::bigint, 'and now belongs to both');

-- ======================================================= the org_roles claim

select is(
  app.custom_access_token(jsonb_build_object(
    'user_id', tests.id('confirmed_contractor')::text,
    'claims', '{}'::jsonb
  )) -> 'claims' -> 'org_roles' -> (tests.id('org_a')::text),
  '["contractor"]'::jsonb,
  'the token carries the role held in each organization');

select is(
  app.custom_access_token(jsonb_build_object(
    'user_id', tests.id('owner_a')::text, 'claims', '{}'::jsonb
  )) -> 'claims' -> 'org_roles' -> (tests.id('org_a')::text),
  '["owner"]'::jsonb,
  'an owner is named as one');

select is(
  (select count(*) from jsonb_object_keys(
     app.custom_access_token(jsonb_build_object(
       'user_id', tests.id('confirmed_contractor')::text, 'claims', '{}'::jsonb
     )) -> 'claims' -> 'org_roles')),
  2::bigint,
  'a contractor in two organizations gets both');

select is(
  app.custom_access_token(jsonb_build_object(
    'user_id', tests.id('bare_user')::text, 'claims', '{}'::jsonb
  )) -> 'claims' -> 'org_roles',
  '{}'::jsonb,
  'someone in no organization gets an empty claim, not a missing one');

select is(
  app.custom_access_token(jsonb_build_object(
    'user_id', tests.id('owner_a')::text,
    'claims', '{"sub": "keep-me"}'::jsonb
  )) -> 'claims' ->> 'sub',
  'keep-me', 'and the claims already on the token are left alone');

-- A suspended membership is not a membership.
update public.memberships set status = 'suspended'
 where user_id = tests.id('owner_a') and org_id = tests.id('org_a');

select is(
  app.custom_access_token(jsonb_build_object(
    'user_id', tests.id('owner_a')::text, 'claims', '{}'::jsonb
  )) -> 'claims' -> 'org_roles',
  '{}'::jsonb,
  'suspending a membership drops it from the token');

select ok(
  not has_function_privilege('authenticated', 'app.custom_access_token(jsonb)', 'execute'),
  'the hook is not callable by a client');

select ok(
  has_function_privilege('supabase_auth_admin', 'app.custom_access_token(jsonb)', 'execute'),
  'but is callable by the auth server');

select * from finish();
rollback;
