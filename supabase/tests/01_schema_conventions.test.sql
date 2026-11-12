-- CLAUDE.md rules 1, 5, 6 and 10, asserted against the catalog rather than by
-- eye: if a later migration adds a table without org_id, RLS, policies or an
-- index on a foreign key, this file fails.

begin;
set local search_path to public, extensions, tests;
\ir helpers.psql
select * from no_plan();

-- ---- rule 1: RLS on every table, with explicit policies

select is(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity),
  0::bigint,
  'every table in public has row level security enabled');

select is(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  0::bigint,
  'every table in public has at least one policy');

-- ---- rule 1: org_id not null, and indexed, on every organization-scoped table

create temporary table org_scoped (table_name text primary key) on commit drop;
insert into org_scoped (table_name) values
  ('memberships'), ('compliance_documents'), ('clients'), ('client_contacts'),
  ('events'), ('event_contacts'), ('briefs'), ('slots'), ('assignments'),
  ('shot_list_items'), ('shot_checks'), ('deliverables'), ('deliverable_reviews'),
  ('uploads'), ('upload_parts'), ('connector_accounts'), ('connector_rules'), ('sync_jobs'),
  ('payouts'), ('ratings'), ('announcements'), ('notifications'), ('activity_log');

select is(
  (select count(*)
     from org_scoped o
    where not exists (
      select 1
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = o.table_name
         and c.column_name = 'org_id'
         and c.is_nullable = 'NO'
         and c.data_type = 'uuid')),
  0::bigint,
  'every organization-scoped table has org_id uuid not null');

select is(
  (select count(*)
     from org_scoped o
    where not exists (
      select 1
        from pg_index i
        join pg_class t on t.oid = i.indrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
       where n.nspname = 'public'
         and t.relname = o.table_name
         and a.attname = 'org_id')),
  0::bigint,
  'every organization-scoped table has an index led by org_id');

-- ---- rule 10: index every foreign key
-- Checks the leading column of the foreign key, which is what makes the
-- reference lookups and cascading deletes cheap.

select is(
  (select count(*)
     from pg_constraint fk
    where fk.contype = 'f'
      and fk.connamespace = 'public'::regnamespace
      and not exists (
        select 1
          from pg_index i
         where i.indrelid = fk.conrelid
           and i.indkey[0] = fk.conkey[1])),
  0::bigint,
  'every foreign key has an index on its leading column');

-- ---- rule 5: integer cents, UTC timestamps, IANA zone on the event

select is(
  (select count(*)
     from information_schema.columns
    where table_schema = 'public'
      and column_name like '%\_cents'
      and data_type not in ('integer', 'bigint')),
  0::bigint,
  'every amount column is integer cents');

select is(
  (select count(*)
     from information_schema.columns
    where table_schema = 'public'
      and data_type = 'money'),
  0::bigint,
  'no column uses the money type');

select is(
  (select count(*)
     from information_schema.columns
    where table_schema = 'public'
      and data_type = 'timestamp without time zone'),
  0::bigint,
  'no column stores a timestamp without a time zone');

select col_not_null('public', 'events', 'time_zone',
  'events.time_zone holds the event IANA zone and is required');

-- ---- rule 6: the state machines are the only way status moves

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = f),
  1::bigint,
  format('public.%s exists', f))
from unnest(array['transition_event', 'transition_assignment', 'transition_payout']) as f;

select ok(
  not has_column_privilege('authenticated', 'public.events', 'status', 'update'),
  'authenticated cannot update events.status directly');

select ok(
  not has_column_privilege('authenticated', 'public.assignments', 'status', 'update'),
  'authenticated cannot update assignments.status directly');

select ok(
  not has_column_privilege('authenticated', 'public.payouts', 'status', 'update'),
  'authenticated cannot update payouts.status directly');

select ok(
  not has_table_privilege('authenticated', 'public.payouts', 'update'),
  'authenticated has no update grant on payouts at all');

select ok(
  not has_table_privilege('authenticated', 'public.uploads', 'insert'),
  'uploads are written by the backend, not by clients');

select ok(
  not has_table_privilege('authenticated', 'public.upload_parts', 'insert'),
  'the part ledger is written by the backend, not by clients');

select ok(
  not has_table_privilege('authenticated', 'public.upload_parts', 'update'),
  'a client cannot edit a part it has already reported');

-- ---- anon reaches nothing

select is(
  (select count(*)
     from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'),
  0::bigint,
  'anon has no table privileges in public');

-- ---- the pre-confirm projection cannot leak packet columns

select hasnt_column('public', 'job_board', 'address',
  'job_board does not expose the exact address');
select hasnt_column('public', 'job_board', 'latitude',
  'job_board does not expose the venue pin');
select hasnt_column('public', 'job_board', 'arrival_notes',
  'job_board does not expose arrival and parking notes');

select * from finish();
rollback;
