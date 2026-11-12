-- transition_payout: draft → submitted → approved → sent → paid, with failed
-- and reversed arriving from Stripe webhooks. The producer submits, the owner
-- approves (or the organization's threshold does), and the platform settles.
-- PRD "Payments → Payout states", CLAUDE.md "State machines".
--
-- Organization A's auto-approval threshold is 25000 cents in the fixture.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- A small payout on one of producer_a's own events, to exercise auto-approval
-- and the settlement cascade.
insert into tests.fixture_ids (name, id) values
  ('slot_p', gen_random_uuid()),
  ('assign_p', gen_random_uuid()),
  ('payout_small', gen_random_uuid());

insert into public.slots (id, org_id, event_id, role, rate_type, rate_amount_cents,
                          call_time, is_required, status)
values (tests.id('slot_p'), tests.id('org_a'), tests.id('event_a'), 'Second camera',
        'flat', 10000, now() + interval '2 days', false, 'filled');

insert into public.assignments (id, org_id, slot_id, user_id, status)
values (tests.id('assign_p'), tests.id('org_a'), tests.id('slot_p'),
        tests.id('eligible_contractor'), 'approved');

insert into public.payouts (id, org_id, assignment_id, amount_cents, status)
values (tests.id('payout_small'), tests.id('org_a'), tests.id('assign_p'), 10000, 'draft');

-- ============================================================ who submits

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a'))),
  '42501', 'a contractor cannot submit their own payout');

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a'))),
  '42501', 'a producer cannot submit a payout on another producer''s event');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a'))),
  'NO_ERROR', 'the event''s producer submits the payout');

select is(
  (select status::text from public.payouts where id = tests.id('payout_a')),
  'submitted', 'the payout is submitted');

select isnt(
  (select submitted_at from public.payouts where id = tests.id('payout_a')),
  null, 'and stamped');

-- ============================================================ who approves

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_payout(%L, ''approved'')', tests.id('payout_a'))),
  '42501', 'a producer cannot approve a payout over the threshold');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_payout(%L, ''approved'')', tests.id('payout_a'))),
  '42501', 'and neither can the contractor being paid');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''approved'')', tests.id('payout_a'))),
  'NO_ERROR', 'the owner approves it');

select is(
  (select approved_by from public.payouts where id = tests.id('payout_a')),
  tests.id('owner_a'), 'the approval records who gave it');

-- =============================================== auto-approval under threshold

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_small'))),
  'NO_ERROR', 'the producer submits a payout under the threshold');

select is(
  (select status::text from public.payouts where id = tests.id('payout_small')),
  'approved', 'a payout under the organization''s threshold approves itself');

select is(
  (select change ->> 'reason' from public.activity_log
    where entity_type = 'payout' and entity_id = tests.id('payout_small')
      and action = 'status_change' and change ->> 'to' = 'approved'
    order by created_at desc, id desc limit 1),
  'under the organization''s auto-approval threshold',
  'and the log says why');

-- ====================================================== sending and settling

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_payout(%L, ''sent'')', tests.id('payout_a'))),
  '42501', 'a producer cannot send the transfer');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''sent'')', tests.id('payout_a'))),
  'NO_ERROR', 'the owner can send it');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_payout(%L, ''paid'')', tests.id('payout_a'))),
  '42501', 'a contractor cannot mark their own payout paid');

select is(
  tests.error_as_service(
    format('select public.transition_payout(%L, ''paid'')', tests.id('payout_a'))),
  'NO_ERROR', 'the Stripe webhook, on the service role, settles it');

select isnt(
  (select paid_at from public.payouts where id = tests.id('payout_a')),
  null, 'settlement is stamped');

-- Settling closes an assignment that was waiting on it.
select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''sent'')', tests.id('payout_small'))),
  'NO_ERROR', 'the small payout is sent');

select is(
  tests.error_as_service(
    format('select public.transition_payout(%L, ''paid'')', tests.id('payout_small'))),
  'NO_ERROR', 'and settled');

select is(
  (select status::text from public.assignments where id = tests.id('assign_p')),
  'paid', 'settling the payout closes the assignment');

-- ============================================================ failure paths

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a2'))),
  'NO_ERROR', 'the other producer submits their own payout');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''approved'')', tests.id('payout_a2'))),
  'NO_ERROR', 'the owner approves it');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''sent'')', tests.id('payout_a2'))),
  'NO_ERROR', 'it is sent');

select is(
  tests.error_as_service(
    format('select public.transition_payout(%L, ''failed'', ''R01 insufficient funds'')',
           tests.id('payout_a2'))),
  'NO_ERROR', 'the bank rejects it and the webhook records the failure');

select is(
  (select failure_reason from public.payouts where id = tests.id('payout_a2')),
  'R01 insufficient funds', 'the reason is kept for the owner alert');

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_a2'))),
  'NO_ERROR', 'a failed payout can be submitted again');

select is(
  tests.error_as_service(
    format('select public.transition_payout(%L, ''reversed'')', tests.id('payout_small'))),
  'NO_ERROR', 'a paid payout can be reversed by webhook');

-- ============================================================ illegal moves

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''submitted'')', tests.id('payout_b'))),
  '42501', 'a payout in another tenant is not the owner of A''s to move');

select is(
  tests.error_as(tests.id('owner_b'),
    format('select public.transition_payout(%L, ''paid'')', tests.id('payout_b'))),
  '23514', 'and a draft payout cannot jump to paid');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_payout(%L, ''approved'')', tests.id('payout_a'))),
  '23514', 'a settled payout cannot be approved again');

select is(
  tests.error_as(tests.id('owner_a'),
    'select public.transition_payout(''00000000-0000-0000-0000-0000000000fd'', ''submitted'')'),
  'P0002', 'transitioning a payout that does not exist raises no_data_found');

select cmp_ok(
  (select count(*) from public.activity_log
    where entity_type = 'payout' and action = 'status_change'),
  '>=', 12::bigint,
  'every payout transition wrote an activity_log row');

select * from finish();
rollback;
