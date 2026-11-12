-- PRD "Permissions and data visibility", matrix row 11 (organization settings,
-- Stripe and connectors: owner only), plus the write side of the matrix —
-- who may insert and update what, and CLAUDE.md rule 6: no client writes a
-- status column.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- ======================================= row 11 — settings, Stripe, connectors

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.organizations'),
  1::bigint, 'row 11 · owner reads the organization row');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.organizations'),
  0::bigint, 'row 11 · producer cannot read organization settings');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.organizations'),
  0::bigint, 'row 11 · a confirmed contractor cannot read organization settings');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.organization_public'),
  1::bigint, 'row 11 · producers still get the name and branding');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.organization_public'),
  1::bigint, 'row 11 · contractors still get the name and branding');

select ok(
  not has_column_privilege('authenticated', 'public.organizations', 'stripe_account_id', 'update'),
  'row 11 · no client writes the Stripe account reference');

select is(
  tests.error_as(tests.id('owner_a'),
    format('insert into public.connector_accounts (org_id, provider, root_folder)
            values (%L, ''google_drive'', ''/Moments'')', tests.id('org_a'))),
  'NO_ERROR', 'row 11 · owner adds a connector');

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.connector_accounts (org_id, provider, root_folder)
            values (%L, ''dropbox'', ''/Nope'')', tests.id('org_a'))),
  '42501', 'row 11 · producer cannot add a connector');

select is(
  tests.rows_affected_as(tests.id('producer_a'),
    format('update public.organizations set name = ''Renamed'' where id = %L', tests.id('org_a'))),
  0::bigint, 'row 11 · producer cannot rename the organization');

select is(
  tests.rows_affected_as(tests.id('owner_a'),
    format('update public.organizations set name = ''Moments to Media Content Co.'' where id = %L',
           tests.id('org_a'))),
  1::bigint, 'row 11 · owner can rename the organization');

-- ================================ rule 6 — status columns are not writable

select is(
  tests.error_as(tests.id('producer_a'),
    format('update public.events set status = ''staffing'' where id = %L', tests.id('event_a'))),
  '42501', 'rule 6 · a producer cannot write events.status directly');

select is(
  tests.error_as(tests.id('owner_a'),
    format('update public.events set status = ''complete'' where id = %L', tests.id('event_a'))),
  '42501', 'rule 6 · not even the owner can write events.status directly');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('update public.assignments set status = ''approved'' where id = %L',
           tests.id('assign_confirmed'))),
  '42501', 'rule 6 · a contractor cannot write assignments.status directly');

select is(
  tests.error_as(tests.id('owner_a'),
    format('update public.payouts set status = ''paid'' where id = %L', tests.id('payout_a'))),
  '42501', 'rule 6 · nobody writes payouts.status directly');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('insert into public.uploads (org_id, assignment_id, storage_key, filename)
            values (%L, %L, ''forged/key.mp4'', ''key.mp4'')',
           tests.id('org_a'), tests.id('assign_confirmed'))),
  '42501', 'rule 7 · a client cannot write an upload row itself');

-- ================================================= opt-in and invite writes

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('insert into public.assignments (org_id, slot_id, user_id, status)
            values (%L, %L, %L, ''interested'')',
           tests.id('org_a'), tests.id('slot_open'), tests.id('eligible_contractor'))),
  'NO_ERROR', 'an eligible contractor can opt into an open call');

select is(
  tests.error_as(tests.id('outsider_contractor'),
    format('insert into public.assignments (org_id, slot_id, user_id, status)
            values (%L, %L, %L, ''interested'')',
           tests.id('org_a'), tests.id('slot_open'), tests.id('outsider_contractor'))),
  '42501', 'an ineligible contractor cannot opt in: out of area, no gear, no documents');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('insert into public.assignments (org_id, slot_id, user_id, status)
            values (%L, %L, %L, ''confirmed'')',
           tests.id('org_a'), tests.id('slot_confirmed'), tests.id('eligible_contractor'))),
  '42501', 'a contractor cannot insert themselves as confirmed');

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.assignments (org_id, slot_id, user_id, status)
            values (%L, %L, %L, ''invited'')',
           tests.id('org_a'), tests.id('slot_open'), tests.id('confirmed_contractor'))),
  'NO_ERROR', 'the event''s producer can invite a contractor');

select is(
  tests.error_as(tests.id('producer_a2'),
    format('insert into public.assignments (org_id, slot_id, user_id, status)
            values (%L, %L, %L, ''invited'')',
           tests.id('org_a'), tests.id('slot_confirmed'), tests.id('eligible_contractor'))),
  '42501', 'a producer cannot invite onto another producer''s event');

select is(
  tests.rows_affected_as(tests.id('confirmed_contractor'),
    format('update public.assignments set note = ''Running from the airport'' where id = %L',
           tests.id('assign_confirmed'))),
  1::bigint, 'a contractor can leave a note on their own assignment');

select is(
  tests.rows_affected_as(tests.id('candidate_contractor'),
    format('update public.assignments set note = ''Not mine'' where id = %L',
           tests.id('assign_confirmed'))),
  0::bigint, 'and not on somebody else''s');

-- ============================================== packet writes stay with admins

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('insert into public.briefs (org_id, event_id, body) values (%L, %L, ''mine now'')',
           tests.id('org_a'), tests.id('event_a2'))),
  '42501', 'a contractor cannot write a brief');

select is(
  tests.rows_affected_as(tests.id('confirmed_contractor'),
    format('update public.briefs set body = ''edited'' where event_id = %L', tests.id('event_a'))),
  0::bigint, 'a confirmed contractor can read the brief but not change it');

select is(
  tests.rows_affected_as(tests.id('producer_a2'),
    format('update public.events set title = ''Hijacked'' where id = %L', tests.id('event_a'))),
  0::bigint, 'a producer cannot edit another producer''s event');

select is(
  tests.rows_affected_as(tests.id('producer_a'),
    format('update public.events set title = ''Desert Classic — Day 1 (rev)'' where id = %L',
           tests.id('event_a'))),
  1::bigint, 'the event''s own producer can edit it');

select is(
  tests.rows_affected_as(tests.id('owner_a'),
    format('update public.events set title = ''Owner edit'' where id = %L', tests.id('event_a'))),
  1::bigint, 'and so can the owner');

-- ======================================================= inbox and activity

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.notifications'),
  1::bigint, 'a contractor reads their own inbox');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.notifications'),
  0::bigint, 'and nobody else''s');

select is(
  tests.rows_affected_as(tests.id('confirmed_contractor'),
    'update public.notifications set read_at = now()'),
  1::bigint, 'marking a notification read is allowed');

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.activity_log'),
  1::bigint, 'admins read the activity log');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.activity_log'),
  0::bigint, 'contractors do not');

select is(
  tests.error_as(tests.id('owner_a'),
    format('insert into public.activity_log (org_id, entity_type, action)
            values (%L, ''event'', ''forged'')', tests.id('org_a'))),
  '42501', 'and nobody writes it by hand');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.announcements'),
  1::bigint, 'a contractor reads organization announcements');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('insert into public.announcements (org_id, author_id, body)
            values (%L, %L, ''listen up'')', tests.id('org_a'), tests.id('confirmed_contractor'))),
  '42501', 'but cannot post one');

select * from finish();
rollback;
