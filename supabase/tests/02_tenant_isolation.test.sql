-- Tenancy: org_id plus RLS must make the other tenant invisible, and the
-- composite keys must make a cross-tenant row impossible to write even for a
-- caller with legitimate access to one of the two organizations.
-- CLAUDE.md rule 1, PRD "Data model".

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- ---- nobody in A sees anything of B's, on any organization-scoped table

select is(
  tests.count_as(tests.id('owner_a'),
    format('select 1 from public.%I where org_id = %L', t, tests.id('org_b'))),
  0::bigint,
  format('owner of A sees no %s rows belonging to B', t))
from unnest(array[
  'memberships', 'compliance_documents', 'clients', 'client_contacts',
  'events', 'event_contacts', 'briefs', 'slots', 'assignments',
  'shot_list_items', 'shot_checks', 'deliverables', 'deliverable_reviews',
  'uploads', 'connector_accounts', 'connector_rules', 'sync_jobs',
  'payouts', 'ratings', 'announcements', 'notifications', 'activity_log'
]) as t;

select is(
  tests.count_as(tests.id('owner_b'),
    format('select 1 from public.%I where org_id = %L', t, tests.id('org_a'))),
  0::bigint,
  format('owner of B sees no %s rows belonging to A', t))
from unnest(array[
  'events', 'slots', 'assignments', 'briefs', 'client_contacts',
  'uploads', 'payouts', 'ratings', 'announcements', 'activity_log'
]) as t;

-- ---- a contractor confirmed in B gets nothing from A

select is(
  tests.count_as(tests.id('contractor_b'),
    format('select 1 from public.events where org_id = %L', tests.id('org_a'))),
  0::bigint,
  'a contractor in B sees no events in A');

select is(
  tests.count_as(tests.id('contractor_b'), 'select 1 from public.job_board'),
  0::bigint,
  'a contractor in B sees no open calls from A');

select is(
  tests.count_as(tests.id('contractor_b'), 'select 1 from public.uploads'),
  1::bigint,
  'a contractor in B still sees their own upload');

-- ---- each side sees its own

select is(
  tests.count_as(tests.id('owner_a'), 'select 1 from public.events'),
  2::bigint,
  'owner of A sees both events of A');

select is(
  tests.count_as(tests.id('owner_b'), 'select 1 from public.events'),
  1::bigint,
  'owner of B sees only the event of B');

-- ---- the composite keys refuse a grafted row even without RLS in the way

select throws_ok(
  format('insert into public.slots (org_id, event_id, role, rate_type, rate_amount_cents, call_time)
          values (%L, %L, ''Grafted'', ''flat'', 1000, now())',
         tests.id('org_a'), tests.id('event_b')),
  '23503',
  null,
  'a slot cannot carry org A while pointing at an event of B');

select throws_ok(
  format('insert into public.assignments (org_id, slot_id, user_id, status)
          values (%L, %L, %L, ''invited'')',
         tests.id('org_a'), tests.id('slot_b'), tests.id('confirmed_contractor')),
  '23503',
  null,
  'an assignment cannot carry org A while pointing at a slot of B');

-- assign_candidate, not assign_confirmed: the latter already has a payout, so
-- payouts_assignment_id_key would fire before the tenant check under test.
select throws_ok(
  format('insert into public.payouts (org_id, assignment_id, amount_cents)
          values (%L, %L, 1000)',
         tests.id('org_b'), tests.id('assign_candidate')),
  '23503',
  null,
  'a payout cannot carry org B while pointing at an assignment of A');

select * from finish();
rollback;
