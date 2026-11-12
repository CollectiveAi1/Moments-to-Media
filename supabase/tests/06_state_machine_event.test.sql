-- transition_event: legal moves, entry conditions, who may call it, and the
-- activity_log entry. CLAUDE.md "State machines" and PRD "Status lifecycles →
-- Event": draft → staffing → staffed → in_progress → uploaded → complete,
-- plus cancelled from any state before in_progress.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- Two fresh drafts of producer_a's, each with one unconfirmed required slot.
-- Fixture statements run as the database owner, so RLS is not in the way.
insert into tests.fixture_ids (name, id) values
  ('event_draft', gen_random_uuid()),
  ('event_draft2', gen_random_uuid()),
  ('slot_draft', gen_random_uuid());

insert into public.events (id, org_id, client_id, producer_id, title,
                           starts_at, ends_at, time_zone, status)
values (tests.id('event_draft'), tests.id('org_a'), tests.id('client_a'),
        tests.id('producer_a'), 'Draft one',
        now() + interval '10 days', now() + interval '10 days 4 hours',
        'America/Phoenix', 'draft'),
       (tests.id('event_draft2'), tests.id('org_a'), tests.id('client_a'),
        tests.id('producer_a'), 'Draft two',
        now() + interval '11 days', now() + interval '11 days 4 hours',
        'America/Phoenix', 'draft');

insert into public.slots (id, org_id, event_id, role, rate_type, rate_amount_cents,
                          call_time, is_required, status)
values (tests.id('slot_draft'), tests.id('org_a'), tests.id('event_draft'), 'Lead video',
        'flat', 60000, now() + interval '10 days', true, 'inviting');

-- ---- who may move an event

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_event(%L, ''staffing'')', tests.id('event_draft'))),
  '42501', 'a contractor cannot transition an event');

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_event(%L, ''staffing'')', tests.id('event_draft'))),
  '42501', 'a producer cannot transition another producer''s event');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''staffing'')', tests.id('event_draft'))),
  'NO_ERROR', 'the event''s producer moves it to staffing');

select is(
  (select status::text from public.events where id = tests.id('event_draft')),
  'staffing', 'the status actually changed');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_event(%L, ''staffing'')', tests.id('event_draft2'))),
  'NO_ERROR', 'the owner can move any event');

-- ---- illegal moves

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''complete'')', tests.id('event_draft2'))),
  '23514', 'staffing cannot jump to complete');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''draft'')', tests.id('event_draft2'))),
  '23514', 'an event cannot go back to draft');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''staffed'')', tests.id('event_draft'))),
  '23514', 'staffed is refused while a required slot has no confirmed contractor');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''uploaded'')', tests.id('event_a'))),
  '23514', 'uploaded is refused straight from staffed');

-- ---- the happy path on the seeded, fully staffed event

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''in_progress'')', tests.id('event_a'))),
  'NO_ERROR', 'a staffed event moves to in progress');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''cancelled'')', tests.id('event_a'))),
  '23514', 'an event in progress can no longer be cancelled');

-- ---- complete needs every deliverable approved

select lives_ok(
  format('update public.events set status = ''uploaded'' where id = %L', tests.id('event_a')),
  'event A is parked at uploaded for the completion check');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''complete'')', tests.id('event_a'))),
  '23514', 'complete is refused while a deliverable is unapproved');

select lives_ok(
  format('insert into public.deliverable_reviews
            (org_id, deliverable_id, assignment_id, decision, reviewer_id)
          values (%L, %L, %L, ''approved'', %L)',
         tests.id('org_a'), tests.id('deliverable_a'),
         tests.id('assign_confirmed'), tests.id('producer_a')),
  'the deliverable is approved');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_event(%L, ''complete'')', tests.id('event_a'))),
  'NO_ERROR', 'complete is allowed once every deliverable is approved');

select isnt(
  (select completed_at from public.events where id = tests.id('event_a')),
  null, 'completing the event stamps completed_at, which starts the 7-day window');

-- ---- cancelling releases the crew

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_event(%L, ''cancelled'')', tests.id('event_a2'))),
  'NO_ERROR', 'a producer cancels their own event before it starts');

select is(
  (select status::text from public.assignments where id = tests.id('assign_a2')),
  'cancelled', 'cancelling the event cancels the confirmed assignment');

select isnt(
  (select cancelled_at from public.events where id = tests.id('event_a2')),
  null, 'and stamps cancelled_at');

-- ---- every move is written to the activity log

select cmp_ok(
  (select count(*) from public.activity_log
    where entity_type = 'event' and action = 'status_change'),
  '>=', 6::bigint,
  'every event transition wrote an activity_log row');

select is(
  (select change ->> 'to' from public.activity_log
    where entity_type = 'event' and entity_id = tests.id('event_a')
      and action = 'status_change'
    order by created_at desc, id desc limit 1),
  'complete', 'the log records what the status became');

select is(
  (select actor_id from public.activity_log
    where entity_type = 'event' and entity_id = tests.id('event_a')
      and action = 'status_change'
    order by created_at desc, id desc limit 1),
  tests.id('producer_a'), 'and who did it');

-- ---- a missing event is a clean error, not a crash

select is(
  tests.error_as(tests.id('owner_a'),
    'select public.transition_event(''00000000-0000-0000-0000-0000000000ff'', ''staffing'')'),
  'P0002', 'transitioning an event that does not exist raises no_data_found');

select * from finish();
rollback;
