-- transition_assignment: the nine states, the four exits, who may make each
-- move, the confirm preconditions and the cascades into slot, event and
-- payout. CLAUDE.md "State machines" and PRD "Status lifecycles → Contractor
-- on a slot" plus "Staffing", steps 4-7.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- A staffing event of producer_a's: one required invited slot, one open call
-- with two people opted in, and a deliverable to review at the end.
insert into tests.fixture_ids (name, id) values
  ('event_w', gen_random_uuid()),
  ('slot_w', gen_random_uuid()),
  ('slot_w2', gen_random_uuid()),
  ('slot_w3', gen_random_uuid()),
  ('assign_w', gen_random_uuid()),
  ('assign_w2_cand', gen_random_uuid()),
  ('assign_w2_conf', gen_random_uuid()),
  ('assign_w3_out', gen_random_uuid()),
  ('assign_w_second', gen_random_uuid()),
  ('deliverable_w', gen_random_uuid());

insert into public.events (id, org_id, client_id, producer_id, title, starts_at, ends_at,
                           time_zone, area_label, address, latitude, longitude, status)
values (tests.id('event_w'), tests.id('org_a'), tests.id('client_a'), tests.id('producer_a'),
        'Lifecycle walk', now() + interval '6 days', now() + interval '6 days 8 hours',
        'America/Phoenix', 'Tempe, AZ', '1 E 1st St, Tempe, AZ',
        33.425500, -111.940000, 'staffing');

insert into public.slots (id, org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                          required_gear, staffing_mode, interest_deadline, is_required, status)
values (tests.id('slot_w'), tests.id('org_a'), tests.id('event_w'), 'Lead video', 'flat', 60000,
        now() + interval '6 days', '{camera_body}', 'direct_invite', null, true, 'inviting'),
       (tests.id('slot_w2'), tests.id('org_a'), tests.id('event_w'), 'Photo', 'day', 45000,
        now() + interval '6 days', '{camera_body}', 'open_call',
        now() + interval '2 days', false, 'open_call'),
       (tests.id('slot_w3'), tests.id('org_a'), tests.id('event_w'), 'Second camera', 'flat', 30000,
        now() + interval '6 days', '{camera_body}', 'direct_invite', null, false, 'inviting');

insert into public.assignments (id, org_id, slot_id, user_id, status, invite_expires_at)
values (tests.id('assign_w'), tests.id('org_a'), tests.id('slot_w'),
        tests.id('eligible_contractor'), 'invited', now() + interval '20 hours'),
       (tests.id('assign_w_second'), tests.id('org_a'), tests.id('slot_w'),
        tests.id('candidate_contractor'), 'invited', now() + interval '20 hours'),
       (tests.id('assign_w3_out'), tests.id('org_a'), tests.id('slot_w3'),
        tests.id('outsider_contractor'), 'invited', now() + interval '20 hours');

insert into public.assignments (id, org_id, slot_id, user_id, status)
values (tests.id('assign_w2_cand'), tests.id('org_a'), tests.id('slot_w2'),
        tests.id('candidate_contractor'), 'interested'),
       (tests.id('assign_w2_conf'), tests.id('org_a'), tests.id('slot_w2'),
        tests.id('confirmed_contractor'), 'interested');

insert into public.deliverables (id, org_id, slot_id, title, due_at)
values (tests.id('deliverable_w'), tests.id('org_a'), tests.id('slot_w'),
        'Highlight reel', now() + interval '9 days');

-- ================================================== only a confirm commits

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w'))),
  '42501', 'nobody else can accept a contractor''s invite');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w'))),
  '42501', 'not even the producer can confirm on a contractor''s behalf');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w'))),
  'NO_ERROR', 'the invited contractor confirms');

select is(
  (select status::text from public.assignments where id = tests.id('assign_w')),
  'confirmed', 'the assignment is confirmed');

select is(
  (select status::text from public.slots where id = tests.id('slot_w')),
  'filled', 'confirming locks the slot');

select is(
  (select status::text from public.events where id = tests.id('event_w')),
  'staffed', 'and the event moves to staffed once every required slot is confirmed');

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w_second'))),
  '23514', 'a second contractor cannot confirm onto a slot that is already committed');

-- Stripe onboarding must be finished first, where the organization pays in app.
select is(
  tests.error_as(tests.id('outsider_contractor'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w3_out'))),
  '23514', 'a contractor who has not finished Stripe onboarding cannot confirm');

-- ============================================== selection on the open call

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''selected'')', tests.id('assign_w2_cand'))),
  '42501', 'a contractor cannot select themselves');

select is(
  tests.error_as(tests.id('producer_a2'),
    format('select public.transition_assignment(%L, ''selected'')', tests.id('assign_w2_cand'))),
  '42501', 'nor can a producer who does not run the event');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''selected'')', tests.id('assign_w2_cand'))),
  'NO_ERROR', 'the event''s producer selects a candidate');

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_w2_cand'))),
  'NO_ERROR', 'the selected contractor confirms');

select is(
  (select status::text from public.assignments where id = tests.id('assign_w2_conf')),
  'not_selected',
  'everyone else who opted in is marked not selected when the slot fills');

-- ======================================================= event-day moves

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''checked_in'')', tests.id('assign_w'))),
  '42501', 'the producer cannot check a contractor in');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_w'))),
  '23514', 'confirmed cannot jump to uploaded');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''checked_in'')', tests.id('assign_w'))),
  'NO_ERROR', 'the contractor checks in');

select isnt(
  (select checked_in_at from public.assignments where id = tests.id('assign_w')),
  null, 'check-in is stamped');

select is(
  (select status::text from public.events where id = tests.id('event_w')),
  'in_progress', 'the first check-in moves the event to in progress');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''checked_out'')', tests.id('assign_w'))),
  'NO_ERROR', 'the contractor checks out');

select isnt(
  (select checked_out_at from public.assignments where id = tests.id('assign_w')),
  null, 'check-out is stamped');

-- ============================================ upload, review loop, payout

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_w'))),
  'NO_ERROR', 'the contractor marks the upload complete');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''approved'')', tests.id('assign_w'))),
  '42501', 'a contractor cannot approve their own work');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''changes_requested'', ''Reshoot the trophy'')',
           tests.id('assign_w'))),
  'NO_ERROR', 'the producer requests changes');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''uploaded'')', tests.id('assign_w'))),
  'NO_ERROR', 'and the contractor uploads again — the review loop repeats');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''approved'')', tests.id('assign_w'))),
  '23514', 'approval is refused while a deliverable on the slot is unapproved');

insert into public.deliverable_reviews (org_id, deliverable_id, assignment_id, decision, reviewer_id)
values (tests.id('org_a'), tests.id('deliverable_w'), tests.id('assign_w'), 'approved',
        tests.id('producer_a'));

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''approved'')', tests.id('assign_w'))),
  'NO_ERROR', 'approval is allowed once the deliverable is approved');

select is(
  (select count(*) from public.payouts where assignment_id = tests.id('assign_w')),
  1::bigint, 'approval queues a payout');

select is(
  (select amount_cents from public.payouts where assignment_id = tests.id('assign_w')),
  60000, 'the payout carries the slot''s flat rate, in cents');

select is(
  (select status::text from public.payouts where assignment_id = tests.id('assign_w')),
  'draft', 'and starts as a draft');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''paid'')', tests.id('assign_w'))),
  '42501', 'paid is a platform move, not a producer one');

select is(
  tests.error_as(tests.id('owner_a'),
    format('select public.transition_assignment(%L, ''paid'')', tests.id('assign_w'))),
  'NO_ERROR', 'the owner may force it');

-- ================================================================== exits

insert into tests.fixture_ids (name, id) values
  ('assign_withdraw', gen_random_uuid()),
  ('assign_decline', gen_random_uuid()),
  ('assign_expire', gen_random_uuid());

insert into public.assignments (id, org_id, slot_id, user_id, status, invite_expires_at)
values (tests.id('assign_withdraw'), tests.id('org_a'), tests.id('slot_w2'),
        tests.id('eligible_contractor'), 'interested', null),
       (tests.id('assign_decline'), tests.id('org_a'), tests.id('slot_w3'),
        tests.id('candidate_contractor'), 'invited', now() + interval '20 hours'),
       (tests.id('assign_expire'), tests.id('org_a'), tests.id('slot_w3'),
        tests.id('confirmed_contractor'), 'invited', now() + interval '20 hours');

select is(
  tests.error_as(tests.id('eligible_contractor'),
    format('select public.transition_assignment(%L, ''withdrawn'')', tests.id('assign_withdraw'))),
  'NO_ERROR', 'exit · a contractor withdraws their own opt-in');

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''declined'', ''Double booked'')',
           tests.id('assign_decline'))),
  'NO_ERROR', 'exit · a contractor declines an invite with a reason');

select is(
  (select note from public.assignments where id = tests.id('assign_decline')),
  'Double booked', 'the reason is kept on the assignment');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_assignment(%L, ''expired'')', tests.id('assign_expire'))),
  '42501', 'exit · expiry is not the contractor''s to declare');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''expired'')', tests.id('assign_expire'))),
  'NO_ERROR', 'exit · the producer expires an invite whose window passed');

select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.transition_assignment(%L, ''confirmed'')', tests.id('assign_expire'))),
  '23514', 'an expired assignment is terminal');

-- ============================ a committed contractor leaving un-staffs it
-- "Staffed" means every required slot has a confirmed contractor, so a drop
-- that uncovers one puts the event back to staffing and releases the slot.

insert into tests.fixture_ids (name, id) values
  ('event_drop', gen_random_uuid()),
  ('slot_drop', gen_random_uuid()),
  ('slot_drop2', gen_random_uuid()),
  ('assign_drop', gen_random_uuid()),
  ('assign_drop2', gen_random_uuid());

insert into public.events (id, org_id, client_id, producer_id, title, starts_at, ends_at,
                           time_zone, area_label, status)
values (tests.id('event_drop'), tests.id('org_a'), tests.id('client_a'), tests.id('producer_a'),
        'Somebody will drop out', now() + interval '8 days', now() + interval '8 days 6 hours',
        'America/Phoenix', 'Tempe, AZ', 'staffed');

insert into public.slots (id, org_id, event_id, role, rate_type, rate_amount_cents, call_time,
                          staffing_mode, is_required, status)
values (tests.id('slot_drop'), tests.id('org_a'), tests.id('event_drop'), 'Lead video',
        'flat', 60000, now() + interval '8 days', 'direct_invite', true, 'filled'),
       (tests.id('slot_drop2'), tests.id('org_a'), tests.id('event_drop'), 'Second camera',
        'flat', 30000, now() + interval '8 days', 'open_call', false, 'filled');

insert into public.assignments (id, org_id, slot_id, user_id, status)
values (tests.id('assign_drop'), tests.id('org_a'), tests.id('slot_drop'),
        tests.id('confirmed_contractor'), 'confirmed'),
       (tests.id('assign_drop2'), tests.id('org_a'), tests.id('slot_drop2'),
        tests.id('candidate_contractor'), 'confirmed');

select is(
  tests.error_as(tests.id('candidate_contractor'),
    format('select public.transition_assignment(%L, ''dropped'')', tests.id('assign_drop2'))),
  'NO_ERROR', 'a contractor drops an open-call slot');

select is(
  (select status::text from public.slots where id = tests.id('slot_drop2')),
  'open_call', 'the open-call slot goes back on the job board');

select is(
  (select status::text from public.events where id = tests.id('event_drop')),
  'staffed', 'a slot that was not required leaves the event staffed');

select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('select public.transition_assignment(%L, ''dropped'')', tests.id('assign_drop'))),
  'NO_ERROR', 'a contractor drops a required slot');

select is(
  (select status::text from public.events where id = tests.id('event_drop')),
  'staffing', 'which un-staffs the event');

select is(
  (select status::text from public.slots where id = tests.id('slot_drop')),
  'inviting', 'and puts the invited slot back to inviting');

-- ========================================================= the audit trail

select cmp_ok(
  (select count(*) from public.activity_log
    where entity_type = 'assignment' and action = 'status_change'),
  '>=', 12::bigint,
  'every assignment transition wrote an activity_log row');

select is(
  (select change ->> 'from' from public.activity_log
    where entity_type = 'assignment' and entity_id = tests.id('assign_w')
      and action = 'status_change'
    order by created_at, id limit 1),
  'invited', 'the log records where each move came from');

select is(
  tests.error_as(tests.id('owner_a'),
    'select public.transition_assignment(''00000000-0000-0000-0000-0000000000fe'', ''confirmed'')'),
  'P0002', 'transitioning an assignment that does not exist raises no_data_found');

select * from finish();
rollback;
