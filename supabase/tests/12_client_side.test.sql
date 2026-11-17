-- The client side (supabase/migrations/20261118000100_client_side.sql and
-- the two after it): who may read and write packages, inquiries, proposals,
-- invoices, payments, messages and released media, and the proposal → sign →
-- invoice → paid flow. Allowed and denied cases (CLAUDE.md rule 10).
--
-- Every statement that starts with `select` and an assertion is one check;
-- scripts/qa/client_db.sh runs this same file against a hosted project inside
-- a transaction that is rolled back.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();
select lives_ok('select tests.seed()', 'fixture seeds two tenants');

-- A value read as an anonymous visitor (the public form and proposal link).
create or replace function tests.value_as_anon(p_query text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon","aud":"anon"}', true);
  perform set_config('role', 'anon', true);
  execute p_query into v;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
  return v;
end;
$$;

create table tests.ids (k text primary key, v text);

-- ================================================================ shape

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('packages', 'leads', 'proposals', 'proposal_items', 'invoices', 'invoice_lines',
                       'invoice_installments', 'client_payments', 'client_messages', 'media_releases')),
  'client side · every new table has row-level security on');

select ok(
  not has_column_privilege('authenticated', 'public.invoices', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.invoices', 'paid_cents', 'update')
  and not has_column_privilege('authenticated', 'public.invoices', 'total_cents', 'update')
  and not has_column_privilege('authenticated', 'public.proposals', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.proposals', 'signature', 'update')
  and not has_column_privilege('authenticated', 'public.leads', 'status', 'update'),
  'client side · no client writes a status, a total or a signature');

select is(tests.error_as_anon('select 1 from public.leads'), '42501', 'anon · reads no inquiries');
select is(tests.error_as_anon('select 1 from public.invoices'), '42501', 'anon · reads no invoices');

-- ============================================================= packages

select is(
  tests.error_as(tests.id('producer_a'),
    format('insert into public.packages (org_id, name, price_cents) values (%L, ''Full day'', 250000)', tests.id('org_a'))),
  'NO_ERROR', 'packages · a producer adds one');
select is(
  tests.error_as(tests.id('confirmed_contractor'),
    format('insert into public.packages (org_id, name, price_cents) values (%L, ''Nope'', 1)', tests.id('org_a'))),
  '42501', 'packages · a contractor cannot');
select is(tests.count_as(tests.id('owner_b'), 'select 1 from public.packages'), 0::bigint,
  'packages · another organization sees none');

-- ============================================================ inquiries

select is(
  tests.error_as_anon(format($q$select public.submit_inquiry('%s', 'Pat Lee', 'pat@example.test', null,
    'Wedding', current_date + 60, 'Columbus', null, 'Hello')$q$,
    (select slug from public.organizations where id = tests.id('org_a')))),
  'NO_ERROR', 'inquiry · anyone can send one through the public form');
select is(
  tests.error_as_anon(format($q$select public.submit_inquiry('%s', 'Pat Lee', 'not-an-email', null,
    null, null, null, null, null)$q$, (select slug from public.organizations where id = tests.id('org_a')))),
  '23514', 'inquiry · a bad email is refused with a reason');
select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.leads'), 1::bigint,
  'inquiry · producers see it');
select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.leads'), 0::bigint,
  'inquiry · contractors do not');
select is(tests.count_as(tests.id('owner_b'), 'select 1 from public.leads'), 0::bigint,
  'inquiry · another organization does not');
select is(
  tests.error_as(tests.id('producer_a'),
    format('select public.set_lead_status(%L, ''booked'')', (select id from public.leads where org_id = tests.id('org_a')))),
  '23514', 'inquiry · nobody marks a lead booked by hand; signing does');

-- ============================================================ proposals

insert into tests.ids
select 'proposal', tests.value_as(tests.id('producer_a'), format($q$
  insert into public.proposals (org_id, created_by, lead_id, title, client_name, client_email, contract_body,
                                event_starts_at, event_ends_at, time_zone, deposit_percent, tax_rate_bp)
  values (%L, %L, %L, 'Lee wedding', 'Pat Lee', 'pat@example.test',
          'You agree to every term of this contract.', now() + interval '60 days',
          now() + interval '60 days 6 hours', 'America/New_York', 30, 725)
  returning id$q$, tests.id('org_a'), tests.id('producer_a'), (select id from public.leads where org_id = tests.id('org_a'))));

select is(
  tests.error_as(tests.id('producer_a'), format($q$
    insert into public.proposal_items (org_id, proposal_id, name, price_cents) values (%L, %L, 'Full day', 250000);
    insert into public.proposal_items (org_id, proposal_id, name, price_cents, optional, selected)
      values (%L, %L, 'Drone', 40000, true, false)$q$,
    tests.id('org_a'), (select v from tests.ids where k = 'proposal'), tests.id('org_a'), (select v from tests.ids where k = 'proposal'))),
  'NO_ERROR', 'proposal · a producer builds a draft');
select is(tests.count_as(tests.id('owner_b'), 'select 1 from public.proposals'), 0::bigint,
  'proposal · another organization cannot see it');
select is(
  tests.error_as(tests.id('confirmed_contractor'), format('select public.send_proposal(%L)', (select v from tests.ids where k = 'proposal'))),
  '42501', 'proposal · a contractor cannot send it');

insert into tests.ids
select 'token', tests.value_as(tests.id('producer_a'), format('select public.send_proposal(%L)', (select v from tests.ids where k = 'proposal')));

select is((select status::text from public.leads where org_id = tests.id('org_a')), 'proposal_sent',
  'proposal · sending moves the inquiry along');
select is(
  tests.error_as(tests.id('producer_a'), format('update public.proposal_items set price_cents = 1 where proposal_id = %L',
    (select v from tests.ids where k = 'proposal'))),
  '23514', 'proposal · what was offered cannot change after sending');
select is(
  tests.value_as_anon(format($q$select public.open_proposal(%L) -> 'totals' ->> 'total_cents'$q$, (select v from tests.ids where k = 'token'))),
  '268125', 'proposal · the link opens without an account and totals without add-ons (250,000 + 7.25%)');
select is((select status::text from public.proposals where id = (select v from tests.ids where k = 'proposal')::uuid), 'viewed',
  'proposal · opening it marks it viewed');
select is(tests.error_as_anon($q$select public.open_proposal('0000000000000000000000000000000000000000000000000000')$q$),
  'P0002', 'proposal · a made-up link opens nothing');
select is(
  tests.error_as_anon(format($q$select public.accept_proposal(%L, 'Pat Lee', 'Someone Else', '{}')$q$, (select v from tests.ids where k = 'token'))),
  '23514', 'proposal · the signature must match the signer');

insert into tests.ids
select 'accept', tests.value_as_anon(format($q$select public.accept_proposal(%L, 'Pat Lee', 'pat lee', array[%L]::uuid[])::text$q$,
  (select v from tests.ids where k = 'token'),
  (select id from public.proposal_items where proposal_id = (select v from tests.ids where k = 'proposal')::uuid and optional)));

insert into tests.ids select 'invoice', (select v::jsonb ->> 'invoice_id' from tests.ids where k = 'accept');
insert into tests.ids select 'event', (select v::jsonb ->> 'event_id' from tests.ids where k = 'accept');
insert into tests.ids select 'client', (select v::jsonb ->> 'client_id' from tests.ids where k = 'accept');

select is((select v::jsonb ->> 'total_cents' from tests.ids where k = 'accept'), '311025',
  'sign · the chosen add-on is in the total (290,000 + 7.25%)');
select is((select status::text from public.events where id = (select v from tests.ids where k = 'event')::uuid), 'draft',
  'sign · the job is created as a Draft event, ready to staff');
select is((select status::text || ' ' || total_cents from public.invoices where id = (select v from tests.ids where k = 'invoice')::uuid),
  'open 311025', 'sign · an open invoice for the signed total');
select is((select sum(amount_cents)::text || ' in ' || count(*) from public.invoice_installments where invoice_id = (select v from tests.ids where k = 'invoice')::uuid),
  '311025 in 2', 'sign · a deposit and a balance that add up to the total');
select is((select status::text from public.leads where org_id = tests.id('org_a')), 'booked', 'sign · the inquiry is booked');
select is((select count(*) from public.org_invitations where client_id = (select v from tests.ids where k = 'client')::uuid and role = 'client' and status = 'pending'),
  1::bigint, 'sign · the signer is invited to the client portal');
select is(
  tests.error_as_anon(format($q$select public.accept_proposal(%L, 'Pat Lee', 'Pat Lee', '{}')$q$, (select v from tests.ids where k = 'token'))),
  '23514', 'sign · a signed proposal cannot be signed again');
select ok((select signed_contract like '%Signed electronically by pat lee%' from public.proposals where id = (select v from tests.ids where k = 'proposal')::uuid),
  'sign · the contract is kept with the signature on it');

-- ======================================================= the client logs in

insert into tests.ids select 'client_user', tests.new_user('client_user', 'pat@example.test', 'Pat Lee')::text;

select is((select count(*) from public.memberships where user_id = (select v from tests.ids where k = 'client_user')::uuid and role = 'client' and status = 'active'),
  1::bigint, 'portal · verifying the invited email makes them a client of the organization');
select is((select count(*) from public.client_contacts where user_id = (select v from tests.ids where k = 'client_user')::uuid),
  1::bigint, 'portal · and attaches the login to their client record');

select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.invoices'), 1::bigint,
  'portal · the client sees their invoice');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.events'), 1::bigint,
  'portal · the client sees their own event and no other');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.proposals'), 1::bigint,
  'portal · the client sees their signed proposal');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.leads'), 0::bigint,
  'portal · the client sees no inquiries');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.slots'), 0::bigint,
  'portal · the client sees no crew slots');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.assignments'), 0::bigint,
  'portal · the client sees no crew assignments');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, 'select 1 from public.payouts'), 0::bigint,
  'portal · the client sees no contractor pay');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, format('select 1 from public.clients where id = %L', tests.id('client_a'))), 0::bigint,
  'portal · the client cannot see another client');
select is(
  tests.rows_affected_as((select v from tests.ids where k = 'client_user')::uuid,
    format('update public.invoices set discount_cents = 311025 where id = %L', (select v from tests.ids where k = 'invoice'))),
  0::bigint, 'portal · the client cannot change their invoice');
select is(
  tests.error_as((select v from tests.ids where k = 'client_user')::uuid,
    format($q$select public.record_client_payment(%L, 1000, 'cash', null, null)$q$, (select v from tests.ids where k = 'invoice'))),
  '42501', 'portal · the client cannot mark their own invoice paid');
select is(
  tests.error_as((select v from tests.ids where k = 'client_user')::uuid,
    format($q$select public.record_stripe_payment(%L, 1000, 'cs_fake', null, 'card')$q$, (select v from tests.ids where k = 'invoice'))),
  '42501', 'portal · nor fake a card payment');

-- ============================================================= payments

select is(
  tests.error_as(tests.id('producer_a'),
    format($q$select public.record_client_payment(%L, 999999, 'check', '#1', null)$q$, (select v from tests.ids where k = 'invoice'))),
  '23514', 'payments · more than is owed is refused');
select is(
  tests.error_as(tests.id('producer_a'),
    format($q$select public.record_client_payment(%L, 93308, 'check', '#1042', null)$q$, (select v from tests.ids where k = 'invoice'))),
  'NO_ERROR', 'payments · a producer records the deposit check');
select is((select status::text || ' ' || paid_cents from public.invoices where id = (select v from tests.ids where k = 'invoice')::uuid),
  'partially_paid 93308', 'payments · the invoice is partly paid');
select is(
  tests.error_as_service(format($q$select public.record_stripe_payment(%L, 217717, 'cs_test_1', 'pi_1', 'card');
    select public.record_stripe_payment(%L, 217717, 'cs_test_1', 'pi_1', 'card')$q$,
    (select v from tests.ids where k = 'invoice'), (select v from tests.ids where k = 'invoice'))),
  'NO_ERROR', 'payments · the Stripe webhook records the balance, twice');
select is((select count(*) from public.client_payments where stripe_session_id = 'cs_test_1'), 1::bigint,
  'payments · a replayed webhook records nothing twice');
select is((select status::text from public.invoices where id = (select v from tests.ids where k = 'invoice')::uuid), 'paid',
  'payments · the invoice is paid');
select is(
  tests.error_as(tests.id('producer_a'), format('select public.void_invoice(%L)', (select v from tests.ids where k = 'invoice'))),
  '42501', 'payments · only an owner voids an invoice');
select is(tests.value_as((select v from tests.ids where k = 'client_user')::uuid, format('select public.client_payments_enabled(%L)::text', tests.id('org_a'))),
  'false', 'payments · card payments are off until the owner turns them on');

-- ============================================================= messages

select is(
  tests.error_as((select v from tests.ids where k = 'client_user')::uuid,
    format($q$insert into public.client_messages (org_id, client_id, author_id, from_client, body) values (%L, %L, %L, true, 'When is delivery?')$q$,
      tests.id('org_a'), (select v from tests.ids where k = 'client'), (select v from tests.ids where k = 'client_user'))),
  'NO_ERROR', 'messages · the client writes to the producers');
select is(
  tests.error_as((select v from tests.ids where k = 'client_user')::uuid,
    format($q$insert into public.client_messages (org_id, client_id, author_id, from_client, body) values (%L, %L, %L, false, 'pretend staff')$q$,
      tests.id('org_a'), (select v from tests.ids where k = 'client'), (select v from tests.ids where k = 'client_user'))),
  '42501', 'messages · the client cannot write as the studio');
select is(tests.count_as(tests.id('producer_a'), 'select 1 from public.client_messages'), 1::bigint, 'messages · producers read it');
select is(tests.count_as(tests.id('confirmed_contractor'), 'select 1 from public.client_messages'), 0::bigint, 'messages · contractors do not');

-- ======================================================== released media

-- The client of event_a, so media can be released to someone.
select lives_ok(format($q$
  insert into public.org_invitations (org_id, role, email, invited_by, client_id)
  values (%L, 'client', 'dana@example.test', %L, %L)$q$, tests.id('org_a'), tests.id('owner_a'), tests.id('client_a')),
  'media · invite event_a''s client');
insert into tests.ids select 'client_a_user', tests.new_user('client_a_user', 'dana@example.test', 'Dana Client')::text;

select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.release_media(%L, 'Ready!')$q$, tests.id('event_a'))),
  '23514', 'media · nothing is released before footage is approved');
update public.assignments set status = 'approved' where id = tests.id('assign_confirmed');
select is(
  tests.error_as(tests.id('confirmed_contractor'), format($q$select public.release_media(%L, 'x')$q$, tests.id('event_a'))),
  '42501', 'media · a contractor cannot release it');
select is(
  tests.error_as(tests.id('producer_a'), format($q$select public.release_media(%L, 'Your film is ready!')$q$, tests.id('event_a'))),
  'NO_ERROR', 'media · the producer releases approved media');
select is(tests.count_as((select v from tests.ids where k = 'client_a_user')::uuid, format('select * from public.client_media(%L)', tests.id('event_a'))),
  1::bigint, 'media · the client lists their file');
select is(tests.count_as((select v from tests.ids where k = 'client_a_user')::uuid, format('select 1 from public.uploads where id = %L', tests.id('upload_a'))),
  1::bigint, 'media · and can read the upload, so footage-download will sign it');
select is(tests.count_as((select v from tests.ids where k = 'client_a_user')::uuid, format('select 1 from public.uploads where id = %L', tests.id('upload_a2'))),
  0::bigint, 'media · an unreleased event''s footage stays hidden');
select is(tests.count_as((select v from tests.ids where k = 'client_user')::uuid, format('select * from public.client_media(%L)', tests.id('event_a'))),
  0::bigint, 'media · another client gets nothing');

select * from finish();
rollback;
