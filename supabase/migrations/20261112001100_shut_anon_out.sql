-- Security fix: `anon` could execute every function in the public schema.
--
-- Found while applying these migrations to a hosted project: the catalog
-- showed `anon=X/postgres` on transition_event, transition_assignment,
-- transition_payout, claim_invitations and all four upload entry points.
--
-- Where it came from. Supabase's default privileges grant EXECUTE on each new
-- function in `public` to anon, authenticated and service_role. Migration
-- 20261112000500 revoked that -- but it ran *before* 000600, 000800 and
-- 001000 created these functions, so each one arrived with the grant again.
-- The `revoke all on function ... from public` lines in those migrations
-- remove the PUBLIC entry, not an explicit per-role grant, so they did not
-- take it back. This is the same mechanism that gave org_invitations seven
-- table privileges for anon, and 01_schema_conventions only checked tables.
--
-- Why it mattered. Several entry points treat "no user id" as "a trusted
-- server context", which is sound for service_role but not for anon, whose
-- JWT carries a role claim and no `sub`:
--
--   * transition_assignment: the assignee check is
--     `v_assignment.user_id <> auth.uid()`, which is NULL -- not true -- when
--     auth.uid() is null, so it never raises; and the system check is
--     `auth.uid() is not null and not app.is_owner(...)`, which is skipped
--     outright. An unauthenticated caller could confirm, check in, mark
--     uploaded, or settle.
--   * transition_payout: the same system check, so sent/paid/failed/reversed.
--   * record_upload_part, upload_resume_plan, abort_upload: each skips its
--     ownership check when auth.uid() is null, so an unauthenticated caller
--     could read any upload's storage key and part ledger, write parts into
--     someone else's upload, or abort it.
--
-- transition_event was not reachable: it is gated on app.can_manage_event,
-- which fails closed without a user id.
--
-- The fix is in three parts: take the grant back, stop it coming back, and
-- refuse anonymous callers at each entry point so the null-uid shorthand
-- inside the internals means what it says. 11_anon_access.test.sql and the
-- new assertions in 01_schema_conventions fail the build if any of the three
-- regresses.

-- ----------------------------------------------------------- take it back

revoke all on all functions in schema public from anon;

-- And stop the default applying to functions added later. 20261112000800 did
-- the same for tables. authenticated is included because a function it may
-- call should say so explicitly, the way every one below does.
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- -------------------------------------------------------------- the guard

create or replace function app.caller_is_anonymous()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  -- No claims at all is a direct server connection: a migration, a cron job,
  -- psql. Every request that arrives through PostgREST carries them.
  if v_claims is null then
    return false;
  end if;

  return coalesce(v_claims::jsonb ->> 'role', '') = 'anon';
exception when others then
  -- Claims we cannot read are not a trusted context either.
  return true;
end;
$$;

comment on function app.caller_is_anonymous() is
  'True when the caller arrived with an anon JWT. The public entry points refuse those, which is what makes "auth.uid() is null" mean "a trusted server context" inside the internals.';

-- --------------------------------------------------------- state machines

create or replace function public.transition_event(
  p_event_id uuid,
  p_to       public.event_status,
  p_reason   text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.caller_is_anonymous() then
    raise exception 'sign in to move an event'
      using errcode = 'insufficient_privilege';
  end if;

  return app.transition_event_internal(p_event_id, p_to, p_reason, true);
end;
$$;

create or replace function public.transition_assignment(
  p_assignment_id uuid,
  p_to            public.assignment_status,
  p_note          text default null
)
returns public.assignments
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.caller_is_anonymous() then
    raise exception 'sign in to move an assignment'
      using errcode = 'insufficient_privilege';
  end if;

  return app.transition_assignment_internal(p_assignment_id, p_to, p_note, true, true);
end;
$$;

create or replace function public.transition_payout(
  p_payout_id uuid,
  p_to        public.payout_status,
  p_reason    text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.caller_is_anonymous() then
    raise exception 'sign in to move a payout'
      using errcode = 'insufficient_privilege';
  end if;

  return app.transition_payout_internal(p_payout_id, p_to, p_reason, true, true);
end;
$$;

create or replace function public.claim_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.caller_is_anonymous() then
    raise exception 'sign in to claim an invitation'
      using errcode = 'insufficient_privilege';
  end if;

  return app.claim_invitations_for(auth.uid());
end;
$$;

comment on function public.claim_invitations() is
  'Accepts any pending invitation matching the caller''s verified email or phone, and returns how many. Safe to call on every sign-in: it is idempotent.';

-- --------------------------------------------------- upload entry points
-- Unchanged apart from the guard. Each of these decides ownership with
-- `auth.uid() is not null and not app.owns_assignment(...)`, which is only
-- sound once an anonymous caller cannot get this far.

create or replace function public.start_upload(
  p_slot_id            uuid,
  p_filename           text,
  p_bytes              bigint,
  p_checksum           text,
  p_kind               public.upload_kind default 'raw',
  p_part_size_bytes    bigint default null,
  p_checksum_algorithm text default 'sha256'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_upload     public.uploads;
  v_part_size  bigint;
  v_part_count integer;
  v_attempt    integer := 0;
begin
  -- Anonymous callers have no business here; see the header of this file.
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- what the client sent

  if nullif(btrim(coalesce(p_filename, '')), '') is null then
    raise exception 'an upload needs a filename' using errcode = 'check_violation';
  end if;

  -- The filename becomes the last segment of an object key, so it may not
  -- carry a path of its own.
  if p_filename ~ '[/\\]' or p_filename ~ '^\.' or length(p_filename) > 255 then
    raise exception 'filename % is not usable as an object key', p_filename
      using errcode = 'check_violation',
            hint = 'No slashes or backslashes, no leading dot, 255 characters or fewer.';
  end if;

  if p_bytes is null or p_bytes <= 0 then
    raise exception 'an upload needs a positive size, got %', p_bytes
      using errcode = 'check_violation';
  end if;

  -- S3 and R2 cap a single object at 5 TiB.
  if p_bytes > 5497558138880 then
    raise exception 'upload of % bytes is over the 5 TiB object limit', p_bytes
      using errcode = 'check_violation';
  end if;

  if nullif(btrim(coalesce(p_checksum, '')), '') is null then
    raise exception 'an upload must declare its checksum before it starts'
      using errcode = 'check_violation',
            hint = 'The client chunks the file, so it can compute the composite checksum up front.';
  end if;

  -- ---- who is asking
  -- PRD "How an upload works", step 1: the backend checks that the contractor
  -- is confirmed on that slot. Not role alone (CLAUDE.md rule 2) — the
  -- caller's own assignment, in a state where there is footage to send.

  select * into v_assignment
  from public.assignments a
  where a.slot_id = p_slot_id
    and a.user_id = auth.uid();

  if not found then
    raise exception 'you have no assignment on slot %', p_slot_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_assignment.status <> all (array[
       'checked_in', 'checked_out', 'uploaded', 'changes_requested'
     ]::public.assignment_status[])
  then
    raise exception 'assignment % is %, so uploads are not open', v_assignment.id, v_assignment.status
      using errcode = 'check_violation',
            hint = 'Uploads open at check-in and stay open through the review loop.';
  end if;

  -- ---- the part plan

  v_part_size := coalesce(p_part_size_bytes, app.plan_part_size(p_bytes));
  v_part_count := ceil(p_bytes::numeric / v_part_size);

  if v_part_count > 10000 then
    raise exception 'a part size of % bytes needs % parts, over the 10000 limit',
      v_part_size, v_part_count
      using errcode = 'check_violation';
  end if;

  if v_part_count > 1 and v_part_size < 5242880 then
    raise exception 'a part size of % bytes is under the 5 MiB minimum', v_part_size
      using errcode = 'check_violation';
  end if;

  if v_part_size > 5368709120 then
    raise exception 'a part size of % bytes is over the 5 GiB maximum', v_part_size
      using errcode = 'check_violation';
  end if;

  -- ---- write it
  -- The key is derived, and two uploads of the same filename started at once
  -- would derive the same one. The unique index is the arbiter; this retries
  -- around it rather than failing the contractor's upload.

  loop
    v_attempt := v_attempt + 1;

    begin
      insert into public.uploads
        (org_id, assignment_id, kind, storage_key, filename, bytes, checksum,
         checksum_algorithm, part_size_bytes, part_count, status)
      values
        (v_assignment.org_id, v_assignment.id, p_kind,
         app.upload_storage_key(v_assignment.id, p_kind, p_filename),
         p_filename, p_bytes, p_checksum, p_checksum_algorithm,
         v_part_size, v_part_count, 'pending')
      returning * into v_upload;

      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.upload_parts (org_id, upload_id, part_number, bytes)
  select v_upload.org_id, v_upload.id, n,
         least(v_part_size, p_bytes - (n - 1)::bigint * v_part_size)
  from generate_series(1, v_part_count) as n;

  perform app.log_activity(
    v_upload.org_id, 'upload', v_upload.id, 'upload_started',
    jsonb_build_object('assignment_id', v_assignment.id, 'slot_id', p_slot_id,
                       'filename', p_filename, 'bytes', p_bytes,
                       'part_count', v_part_count));

  return jsonb_build_object(
    'upload_id', v_upload.id,
    'storage_key', v_upload.storage_key,
    'status', v_upload.status,
    'bytes', v_upload.bytes,
    'checksum', v_upload.checksum,
    'checksum_algorithm', v_upload.checksum_algorithm,
    'part_size_bytes', v_part_size,
    'part_count', v_part_count,
    'parts', (select jsonb_agg(jsonb_build_object('part_number', up.part_number,
                                                  'bytes', up.bytes)
                               order by up.part_number)
                from public.upload_parts up
               where up.upload_id = v_upload.id));
end;
$$;

create or replace function public.record_upload_part(
  p_upload      uuid,
  p_part_number integer,
  p_etag        text,
  p_checksum    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  -- Anonymous callers have no business here; see the header of this file.
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_upload from public.uploads where id = p_upload;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  -- A client may only touch its own upload; the backend (no JWT) may touch any.
  if auth.uid() is not null and not app.owns_assignment(v_upload.assignment_id) then
    raise exception 'upload % does not belong to you', p_upload
      using errcode = 'insufficient_privilege';
  end if;

  if v_upload.status <> 'in_progress' then
    raise exception 'upload % is %, so parts cannot be recorded', p_upload, v_upload.status
      using errcode = 'check_violation';
  end if;

  if nullif(btrim(coalesce(p_etag, '')), '') is null then
    raise exception 'a part needs the ETag R2 returned' using errcode = 'check_violation';
  end if;

  -- A retried part gets a new ETag, so the latest report wins.
  update public.upload_parts
     set etag        = p_etag,
         checksum    = coalesce(p_checksum, checksum),
         uploaded_at = clock_timestamp()
   where upload_id = p_upload
     and part_number = p_part_number;

  if not found then
    raise exception 'upload % has no part %', p_upload, p_part_number
      using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.upload_resume_plan(p_upload uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  -- Anonymous callers have no business here; see the header of this file.
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_upload from public.uploads where id = p_upload;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and not app.owns_assignment(v_upload.assignment_id)
     and not app.is_owner(v_upload.org_id)
     and not app.can_see_event_money_and_footage(app.assignment_event(v_upload.assignment_id))
  then
    raise exception 'upload % does not belong to you', p_upload
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'upload_id', v_upload.id,
    'status', v_upload.status,
    'storage_key', v_upload.storage_key,
    'multipart_upload_id', v_upload.multipart_upload_id,
    'bytes', v_upload.bytes,
    'part_size_bytes', v_upload.part_size_bytes,
    'part_count', v_upload.part_count,
    'bytes_received', coalesce((select sum(up.bytes) from public.upload_parts up
                                 where up.upload_id = p_upload and up.etag is not null), 0),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number,
                                                             'bytes', up.bytes)
                                          order by up.part_number)
                           from public.upload_parts up
                          where up.upload_id = p_upload and up.etag is null),
                        '[]'::jsonb),
    'landed', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number,
                                                            'etag', up.etag,
                                                            'checksum', up.checksum)
                                         order by up.part_number)
                          from public.upload_parts up
                         where up.upload_id = p_upload and up.etag is not null),
                       '[]'::jsonb));
end;
$$;

create or replace function public.abort_upload(p_upload uuid, p_reason text default null)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  -- Anonymous callers have no business here; see the header of this file.
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_upload from public.uploads where id = p_upload;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and not app.owns_assignment(v_upload.assignment_id)
     and not app.can_manage_event(app.assignment_event(v_upload.assignment_id))
  then
    raise exception 'upload % is not yours to abort', p_upload
      using errcode = 'insufficient_privilege';
  end if;

  return app.abort_upload(p_upload, p_reason);
end;
$$;

-- ------------------------------------------------------------- the grants
-- `create or replace` keeps a function's privileges, but the revoke above
-- cleared anon's, so every grant this schema intends is restated here and
-- nowhere does anon appear.

grant execute on function public.transition_event(uuid, public.event_status, text)
  to authenticated, service_role;
grant execute on function public.transition_assignment(uuid, public.assignment_status, text)
  to authenticated, service_role;
grant execute on function public.transition_payout(uuid, public.payout_status, text)
  to authenticated, service_role;
grant execute on function public.claim_invitations() to authenticated, service_role;

grant execute on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text)
  to authenticated, service_role;
grant execute on function public.record_upload_part(uuid, integer, text, text)
  to authenticated, service_role;
grant execute on function public.upload_resume_plan(uuid) to authenticated, service_role;
grant execute on function public.abort_upload(uuid, text) to authenticated, service_role;
