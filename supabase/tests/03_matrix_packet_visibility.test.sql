-- PRD "Permissions and data visibility", matrix rows 1-6, every cell:
--
--   row 1  Event date, area, role, rate, gear needed
--   row 2  Exact address, arrival and parking
--   row 3  Client and on-site contact
--   row 4  Creative brief, shot list, deliverables
--   row 5  Other crew on the event
--   row 6  Emergency contacts
--
-- Columns: Owner · Producer · Contractor not on slot · Contractor opted in or
-- invited · Contractor confirmed. The last section checks the 7-day window
-- after the event completes.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- =========================================== row 1 — date, area, role, rate
-- Admins read the tables. A contractor reads the coarse projection: the job
-- board when eligible for an open call, their own slots when invited or
-- opted in.

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.slots'),
  3::bigint, 'row 1 · owner sees every slot in the organization');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.slots'),
  3::bigint, 'row 1 · producer sees every slot in the organization');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.job_board'),
  0::bigint, 'row 1 · contractor not on a slot and not eligible sees no open calls');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.slots'),
  0::bigint, 'row 1 · contractor not on a slot and not eligible sees no slots');

select is(tests.count_as(tests.id('eligible_contractor'), 'select 1 from public.job_board'),
  1::bigint, 'row 1 · contractor eligible for the open call sees it on the job board');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.job_board'),
  1::bigint, 'row 1 · contractor who opted in sees their slot on the job board');

select is(
  tests.value_as(tests.id('candidate_contractor'),
    format('select role from public.job_board where slot_id = %L', tests.id('slot_open'))),
  'Photo', 'row 1 · the job board carries the role');

select isnt(
  tests.value_as(tests.id('candidate_contractor'),
    format('select area_label from public.job_board where slot_id = %L', tests.id('slot_open'))),
  null, 'row 1 · the job board carries the coarse area');

select is(
  tests.value_as(tests.id('eligible_contractor'),
    format('select rate_amount_cents::text from public.job_board where slot_id = %L', tests.id('slot_open'))),
  '45000', 'row 1 · the job board carries the rate in cents');

-- ========================================= row 2 — exact address and arrival

select isnt(
  tests.value_as(tests.id('owner_a'),
    format('select address from public.events where id = %L', tests.id('event_a'))),
  null, 'row 2 · owner reads the exact address');

select isnt(
  tests.value_as(tests.id('producer_a'),
    format('select arrival_notes from public.events where id = %L', tests.id('event_a'))),
  null, 'row 2 · producer reads arrival and parking notes');

select is(
  tests.count_as(tests.id('outsider_contractor'),
    format('select 1 from public.events where id = %L', tests.id('event_a'))),
  0::bigint, 'row 2 · contractor not on a slot cannot reach the event row');

select is(
  tests.count_as(tests.id('eligible_contractor'),
    format('select 1 from public.events where id = %L', tests.id('event_a'))),
  0::bigint, 'row 2 · eligibility for an open call does not reveal the address');

select is(
  tests.count_as(tests.id('candidate_contractor'),
    format('select 1 from public.events where id = %L', tests.id('event_a'))),
  0::bigint, 'row 2 · contractor who opted in cannot reach the event row');

select isnt(
  tests.value_as(tests.id('confirmed_contractor'),
    format('select address from public.events where id = %L', tests.id('event_a'))),
  null, 'row 2 · confirmed contractor reads the exact address');

select isnt(
  tests.value_as(tests.id('confirmed_contractor'),
    format('select parking_notes from public.events where id = %L', tests.id('event_a'))),
  null, 'row 2 · confirmed contractor reads the parking notes');

-- ======================================= row 3 — client and on-site contact

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.client_contacts'),
  1::bigint, 'row 3 · owner reads client contacts');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.clients'),
  1::bigint, 'row 3 · producer reads the client list');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.client_contacts'),
  0::bigint, 'row 3 · contractor not on a slot sees no client contact');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.client_contacts'),
  0::bigint, 'row 3 · contractor who opted in sees no client contact');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.client_contacts'),
  1::bigint, 'row 3 · confirmed contractor sees the on-site contact');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.clients'),
  0::bigint, 'row 3 · the client record itself stays with admins');

-- ================================ row 4 — brief, shot list and deliverables

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.briefs'),
  1::bigint, 'row 4 · owner reads the brief');

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.shot_list_items'),
  2::bigint, 'row 4 · producer reads the shot list');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.briefs'),
  0::bigint, 'row 4 · contractor not on a slot sees no brief');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.briefs'),
  0::bigint, 'row 4 · contractor who opted in cannot read the brief body');

select is(
  tests.value_as(tests.id('candidate_contractor'),
    format('select brief_summary from public.job_board where slot_id = %L', tests.id('slot_open'))),
  'Hero highlight reel plus 40 edited stills.',
  'row 4 · contractor who opted in gets the summary line, and only that');

select is(
  tests.value_as(tests.id('eligible_contractor'),
    format('select coalesce(brief_summary, ''<null>'') from public.job_board where slot_id = %L',
           tests.id('slot_open'))),
  '<null>',
  'row 4 · a contractor who has not opted in gets no summary either');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.shot_list_items'),
  0::bigint, 'row 4 · contractor who opted in sees no shot list');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.deliverables'),
  0::bigint, 'row 4 · contractor who opted in sees no deliverables');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.briefs'),
  1::bigint, 'row 4 · confirmed contractor reads the brief');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.shot_list_items'),
  2::bigint, 'row 4 · confirmed contractor reads the shot list');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.deliverables'),
  1::bigint, 'row 4 · confirmed contractor reads the deliverables');

-- ======================================== row 5 — other crew on the event

select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.event_crew'),
  2::bigint, 'row 5 · producer sees the crew');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.event_crew'),
  0::bigint, 'row 5 · contractor not on a slot sees no crew');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.event_crew'),
  0::bigint, 'row 5 · contractor who opted in sees no crew');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.event_crew'),
  2::bigint, 'row 5 · confirmed contractor sees the crew on their events');

select isnt(
  tests.value_as(tests.id('confirmed_contractor'),
    format('select phone from public.event_crew where event_id = %L', tests.id('event_a'))),
  null, 'row 5 · the crew list carries names, roles and phone numbers');

-- ========================================== row 6 — emergency contacts

select is(tests.count_as(tests.id('owner_a'), 'select 1 from public.event_contacts'),
  2::bigint, 'row 6 · owner reads on-site and emergency contacts');

select is(tests.count_as(tests.id('producer_a'),
    'select 1 from public.event_contacts where kind = ''emergency'''),
  1::bigint, 'row 6 · producer reads emergency contacts');

select is(tests.count_as(tests.id('outsider_contractor'), 'select 1 from public.event_contacts'),
  0::bigint, 'row 6 · contractor not on a slot sees no emergency contacts');

select is(tests.count_as(tests.id('candidate_contractor'), 'select 1 from public.event_contacts'),
  0::bigint, 'row 6 · contractor who opted in sees no emergency contacts');

select is(tests.count_as(tests.id('confirmed_contractor'),
    'select 1 from public.event_contacts where kind = ''emergency'''),
  1::bigint, 'row 6 · confirmed contractor sees the emergency contacts');

-- ============================ the packet closes 7 days after completion
-- "Access to the full packet ends 7 days after the event completes, except the
-- contractor's own uploads and payout records."

select lives_ok(
  format('update public.events set status = ''complete'', completed_at = now() - interval ''8 days''
          where id = %L', tests.id('event_a')),
  'event A completed eight days ago');

select is(
  tests.count_as(tests.id('confirmed_contractor'),
    format('select 1 from public.events where id = %L', tests.id('event_a'))),
  0::bigint, 'retention · the event row closes after 7 days');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.briefs'),
  0::bigint, 'retention · the brief closes after 7 days');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.event_contacts'),
  0::bigint, 'retention · the contacts close after 7 days');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.shot_list_items'),
  0::bigint, 'retention · the shot list closes after 7 days');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.uploads'),
  2::bigint, 'retention · the contractor keeps their own uploads');

select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.payouts'),
  2::bigint, 'retention · the contractor keeps their own payout records');

select * from finish();
rollback;
