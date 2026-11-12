-- PRD "Permissions and data visibility", matrix rows 7-10:
--
--   row 7   Footage                        All · Own events · No · No · Own uploads only
--   row 8   Contractor profiles            All · All · Own only · Own only · Own only
--   row 9   Ratings and reliability score  All · All · No · No · No
--   row 10  Payouts                        All · Own events · Own only · Own only · Own only
--
-- "Own events" is the producer distinction: producer_a runs event A, producer_a2
-- runs event A2, and neither sees the other's footage or payouts.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- ========================================================= row 7 — footage

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.uploads'),
  2::bigint, 'row 7 · owner sees all footage in the organization');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.uploads'),
  1::bigint, 'row 7 · producer sees footage from their own events only');

select is(
  tests.count_as(tests.id('producer_a'),
    format('select 1 from public.uploads where id = %L', tests.id('upload_a2'))),
  0::bigint, 'row 7 · producer cannot see another producer''s event footage');

select is(tests.count_as(tests.id('producer_a2'), 'select 1 from public.uploads'),
  1::bigint, 'row 7 · the other producer sees their own event footage');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.uploads'),
  0::bigint, 'row 7 · contractor not on a slot sees no footage');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.uploads'),
  0::bigint, 'row 7 · contractor who opted in sees no footage');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.uploads'),
  2::bigint, 'row 7 · confirmed contractor sees their own uploads');

select is(
  tests.count_as(tests.id('confirmed_contractor'),
    format('select 1 from public.uploads where id = %L', tests.id('upload_b'))),
  0::bigint, 'row 7 · and nobody else''s');

-- ================================================= row 8 — contractor profiles

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.profiles'),
  7::bigint, 'row 8 · owner sees every profile in the organization');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.profiles'),
  7::bigint, 'row 8 · producer sees every profile in the organization');

select is(
  tests.count_as(tests.id('owner_a'),
    format('select 1 from public.profiles where user_id = %L', tests.id('contractor_b'))),
  0::bigint, 'row 8 · but not a profile from another tenant''s roster');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.profiles'),
  1::bigint, 'row 8 · contractor not on a slot sees their own profile only');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.profiles'),
  1::bigint, 'row 8 · contractor who opted in sees their own profile only');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.profiles'),
  1::bigint, 'row 8 · confirmed contractor sees their own profile only');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.contractor_details'),
  1::bigint, 'row 8 · and their own contractor details only');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.equipment'),
  1::bigint, 'row 8 · and their own equipment only');

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.equipment'),
  3::bigint, 'row 8 · the directory shows admins the roster''s equipment');

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.compliance_documents'),
  3::bigint, 'row 8 · and the roster''s compliance status');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.compliance_documents'),
  1::bigint, 'row 8 · a contractor sees only their own documents');

-- ========================================================= row 9 — ratings

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.ratings'),
  1::bigint, 'row 9 · owner reads ratings');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.ratings'),
  1::bigint, 'row 9 · producer reads ratings');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.ratings'),
  0::bigint, 'row 9 · contractor not on a slot sees no ratings');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.ratings'),
  0::bigint, 'row 9 · contractor who opted in sees no ratings');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.ratings'),
  0::bigint, 'row 9 · a confirmed contractor cannot see ratings, not even their own');

-- ========================================================= row 10 — payouts

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.payouts'),
  2::bigint, 'row 10 · owner sees every payout');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.payouts'),
  1::bigint, 'row 10 · producer sees payouts on their own events only');

select is(
  tests.count_as(tests.id('producer_a'),
    format('select 1 from public.payouts where id = %L', tests.id('payout_a2'))),
  0::bigint, 'row 10 · producer cannot see another producer''s event payouts');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.payouts'),
  0::bigint, 'row 10 · contractor with no assignment sees no payouts');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.payouts'),
  0::bigint, 'row 10 · contractor who opted in sees no payouts');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.payouts'),
  2::bigint, 'row 10 · confirmed contractor sees their own payouts');

select is(
  tests.count_as(tests.id('confirmed_contractor'),
    format('select 1 from public.payouts where id = %L', tests.id('payout_b'))),
  0::bigint, 'row 10 · and nobody else''s');

select * from finish();
rollback;
