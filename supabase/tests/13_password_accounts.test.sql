-- Self sign-up with email and password (20261118000500_password_accounts):
-- nothing is granted before the email is confirmed; crew start pending and
-- see nothing until approved; clients are attached only to records that
-- already carry their confirmed email; nobody signs up as staff.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

create or replace function tests.signup_user(p_name text, p_email text, p_role text, p_org uuid, p_confirmed boolean)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          case when p_confirmed then now() end, now(), now(), '{"provider":"email","providers":["email"]}',
          jsonb_build_object('full_name', p_name, 'signup_role', p_role, 'signup_org', p_org));
  insert into tests.fixture_ids (name, id) values (p_name, v_id);
  return v_id;
end;
$$;

select ok((select count(*) from public.signup_orgs('contractor')) >= 2, 'sign-up · open organizations are listed');
select is(tests.error_as_anon('select * from public.signup_orgs(''client'')'), 'NO_ERROR', 'sign-up · anyone may list them');

-- crew
select lives_ok(format($q$select tests.signup_user('crew_unconfirmed', 'crew1@example.test', 'contractor', %L, false)$q$, tests.id('org_a')), 'crew · signs up');
select is((select count(*) from public.memberships where user_id = tests.id('crew_unconfirmed')), 0::bigint,
  'crew · nothing before the email is confirmed');
update auth.users set email_confirmed_at = now() where id = tests.id('crew_unconfirmed');
select is((select status::text from public.memberships where user_id = tests.id('crew_unconfirmed') and role = 'contractor'), 'pending',
  'crew · confirming makes a pending application');
select is(tests.count_as(tests.id('crew_unconfirmed'), 'select 1 from public.job_board'), 0::bigint, 'crew · a pending applicant sees no jobs');
select is(tests.count_as(tests.id('crew_unconfirmed'), 'select 1 from public.events'), 0::bigint, 'crew · and no events');
select is(tests.count_as(tests.id('crew_unconfirmed'), 'select 1 from public.organization_public'), 0::bigint, 'crew · and is not yet a member');
select is(tests.count_as(tests.id('producer_a'), format('select * from public.pending_contractors(%L)', tests.id('org_a'))), 1::bigint,
  'crew · producers see the application');
select is(tests.count_as(tests.id('owner_b'), format('select * from public.pending_contractors(%L)', tests.id('org_a'))), 0::bigint,
  'crew · another organization does not');
select is(tests.count_as(tests.id('confirmed_contractor'), format('select * from public.pending_contractors(%L)', tests.id('org_a'))), 0::bigint,
  'crew · other contractors do not');
select is(tests.error_as(tests.id('confirmed_contractor'), format('select public.decide_contractor(%L, true)',
  (select id from public.memberships where user_id = tests.id('crew_unconfirmed')))), '42501', 'crew · a contractor cannot approve');
select is(tests.error_as(tests.id('producer_a'), format('select public.decide_contractor(%L, true)',
  (select id from public.memberships where user_id = tests.id('crew_unconfirmed')))), 'NO_ERROR', 'crew · a producer approves');
select is((select status::text from public.memberships where user_id = tests.id('crew_unconfirmed') and role = 'contractor'), 'active', 'crew · now active');
select is(tests.error_as(tests.id('producer_a'), format('select public.decide_contractor(%L, false)',
  (select id from public.memberships where user_id = tests.id('crew_unconfirmed')))), '23514', 'crew · an application is decided once');

-- staff cannot be self-made
select lives_ok(format($q$select tests.signup_user('would_be_owner', 'boss@example.test', 'owner', %L, true)$q$, tests.id('org_a')), 'staff · tries to sign up as owner');
select is((select count(*) from public.memberships where user_id = tests.id('would_be_owner')), 0::bigint, 'staff · gets nothing');

-- clients
select lives_ok(format($q$select tests.signup_user('dana', 'dana@client.test', 'client', %L, true)$q$, tests.id('org_a')), 'client · signs up with an email on file');
select is((select count(*) from public.client_contacts where user_id = tests.id('dana') and client_id = tests.id('client_a')), 1::bigint,
  'client · attached to the client that lists the email');
select is(tests.count_as(tests.id('dana'), 'select 1 from public.events'), 2::bigint, 'client · sees that client''s events');
select is(tests.count_as(tests.id('dana'), 'select 1 from public.slots'), 0::bigint, 'client · and no crew slots');
select lives_ok(format($q$select tests.signup_user('stranger', 'stranger@example.test', 'client', %L, true)$q$, tests.id('org_a')), 'client · a stranger signs up');
select is(tests.count_as(tests.id('stranger'), 'select 1 from public.events'), 0::bigint, 'client · a stranger sees no events');
select is(tests.count_as(tests.id('stranger'), 'select 1 from public.clients'), 0::bigint, 'client · and no clients');

update public.organizations set client_signup = false where id = tests.id('org_b');
select lives_ok(format($q$select tests.signup_user('closed', 'bruno@client.test', 'client', %L, true)$q$, tests.id('org_b')), 'client · signs up where sign-up is off');
select is((select count(*) from public.memberships where user_id = tests.id('closed')), 0::bigint, 'client · gets nothing there');
select is((select count(*) from public.client_contacts where user_id = tests.id('closed')), 0::bigint, 'client · and is not attached');

-- a client record made after the account exists
insert into public.clients (id, org_id, name) values ('00000000-0000-0000-0000-00000000c1c1', tests.id('org_a'), 'Stranger Wedding');
insert into public.client_contacts (org_id, client_id, name, email) values (tests.id('org_a'), '00000000-0000-0000-0000-00000000c1c1', 'Stranger', 'STRANGER@example.test');
select is(tests.value_as(tests.id('stranger'), 'select public.attach_client_records()::text'), '1', 'client · a later record is attached on next sign-in');
select is(tests.count_as(tests.id('stranger'), 'select 1 from public.clients'), 1::bigint, 'client · and shows in their portal');
select is(tests.value_as(tests.id('dana'), 'select public.attach_client_records()::text'), '0', 'client · nothing to attach is a no-op');

select * from finish();
rollback;
