-- The upload pipeline, database half.
--
-- PRD "Footage pipeline → How an upload works" and "→ Folder structure";
-- CLAUDE.md rule 7: footage never passes through our servers, so the database
-- cannot see a single byte of it. What it can do is decide who may open an
-- upload, hand out the plan the client uploads against, keep the part ledger
-- that makes a resume possible, and refuse to call an upload complete until
-- the size and checksum the backend read back from R2 match what was
-- declared. The R2 calls themselves (CreateMultipartUpload, the presigned
-- part URLs, CompleteMultipartUpload, the HEAD that reads the object back)
-- belong to an Edge Function, because that is the only place R2 credentials
-- are allowed to live (rule 4).
--
-- The division of labour, end to end:
--
--   client                     Edge Function                 database
--   ------                     -------------                 --------
--   start_upload  ---------->  public.start_upload  ------->  authorize, build
--                                                             the key, write
--                                                             the part ledger
--                              R2 CreateMultipartUpload
--                              app.attach_multipart  ------>  pending → in_progress
--                              presign part URLs
--   PUT part ------------------------------------------------> (straight to R2)
--   report part  ---------->   public.record_upload_part ---> part ledger
--   ... resume: public.upload_resume_plan says which parts are still missing
--   complete  ------------->   R2 CompleteMultipartUpload
--                              R2 HEAD object
--                              app.complete_upload  -------->  verify, then
--                                                              queue connectors
--
-- Checksums: the client uploads with SHA-256 part checksums, so R2 returns a
-- composite checksum (the digest of the concatenated part digests, with the
-- part count suffixed). The client can compute that value itself before it
-- starts, because it is the one doing the chunking, so it declares it up
-- front and the Edge Function compares R2's answer to the declaration. The
-- part digests are kept here so the composite can be recomputed from the
-- ledger if the two ever disagree. Postgres does not compute any of this —
-- pgcrypto is not enabled and the bytes are not here to hash anyway.

-- ------------------------------------------------------------------ helpers

create or replace function app.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'),
    '');
$$;

comment on function app.slugify(text) is
  'Lowercase, hyphen-separated, ASCII-only. Null for anything with no usable characters.';

-- R2 follows S3's multipart limits: at most 10,000 parts, every part but the
-- last at least 5 MiB, no part over 5 GiB. A fixed part size therefore cannot
-- serve both a 40 MB clip and a 50 GB card dump, so the size is chosen from
-- the file: 8 MiB doubled until the count fits. 8 MiB covers 80 GB; a 50 GB
-- upload is 6,400 parts.
create or replace function app.plan_part_size(p_bytes bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_size bigint := 8 * 1024 * 1024;
begin
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'an upload needs a positive size, got %', p_bytes
      using errcode = 'check_violation';
  end if;

  while ceil(p_bytes::numeric / v_size) > 10000 loop
    v_size := v_size * 2;

    if v_size > 5368709120 then
      raise exception 'file of % bytes cannot be split into 10000 parts of 5 GiB or less', p_bytes
        using errcode = 'check_violation';
    end if;
  end loop;

  return v_size;
end;
$$;

-- ------------------------------------------------------- uploads, completed
-- Three things the original table could not say: what plan the client is
-- uploading against, what the backend actually read back from R2, and why an
-- upload stopped.

alter table public.uploads
  add column part_size_bytes    bigint,
  add column part_count         integer,
  add column checksum_algorithm text not null default 'sha256',
  add column verified_bytes     bigint,
  add column verified_checksum  text,
  add column aborted_at         timestamptz,
  add column failed_reason      text;

alter table public.uploads
  add constraint uploads_checksum_algorithm
    check (checksum_algorithm in ('sha256', 'crc32c'));

alter table public.uploads
  add constraint uploads_part_plan check (
    (part_size_bytes is null) = (part_count is null)
    and (part_count is null or part_count between 1 and 10000)
    and (part_size_bytes is null or part_size_bytes <= 5368709120)
    and (part_size_bytes is null or part_count = 1 or part_size_bytes >= 5242880)
  );

-- An in-flight upload is one R2 has opened; without the multipart id there is
-- nothing to send parts to and nothing to complete.
alter table public.uploads
  add constraint uploads_in_progress_has_multipart_id
    check (status <> 'in_progress' or multipart_upload_id is not null);

-- CLAUDE.md rule 7 as an invariant rather than a code path: an upload cannot
-- be marked completed unless the size and checksum read back from R2 are
-- present and equal to what was declared. This holds against service_role and
-- against a future migration that forgets to go through app.complete_upload.
alter table public.uploads
  add constraint uploads_completed_is_verified check (
    status <> 'completed'
    or (verified_bytes is not null and verified_bytes = bytes
        and verified_checksum is not null and verified_checksum = checksum)
  );

create index uploads_assignment_status_idx on public.uploads (assignment_id, status);

-- ------------------------------------------------------------- upload_parts
-- One row per part, written before the first byte moves. This is what makes a
-- resume possible after the app is killed: the client asks which parts are
-- still missing rather than remembering for itself.

create table public.upload_parts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  upload_id   uuid not null references public.uploads (id) on delete cascade,
  part_number integer not null check (part_number between 1 and 10000),
  bytes       bigint not null check (bytes > 0),
  -- R2's ETag for the part, needed to complete the multipart upload.
  etag        text,
  -- The part's SHA-256 as R2 reported it, so the composite can be recomputed.
  checksum    text,
  uploaded_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint upload_parts_landed_together check ((etag is null) = (uploaded_at is null)),
  unique (upload_id, part_number)
);

create index upload_parts_org_id_idx on public.upload_parts (org_id);
create index upload_parts_missing_idx on public.upload_parts (upload_id)
  where etag is null;

alter table public.upload_parts
  add constraint upload_parts_upload_same_org_fkey
  foreign key (upload_id, org_id) references public.uploads (id, org_id) on delete cascade;

create trigger upload_parts_touch
  before update on public.upload_parts
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------- storage keys
-- PRD "Footage pipeline → Folder structure". The contractor never picks a
-- folder, so the path is derived; original filenames are kept and collisions
-- take a numeric suffix.

create or replace function app.upload_storage_key(
  p_assignment uuid,
  p_kind       public.upload_kind,
  p_filename   text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dir  text;
  v_base text;
  v_ext  text;
  v_key  text;
  v_n    integer := 1;
begin
  select concat_ws(
           '/',
           app.slugify(o.slug),
           coalesce(app.slugify(c.name), 'internal'),
           to_char((e.starts_at at time zone e.time_zone)::date, 'YYYY-MM-DD')
             || '_' || coalesce(app.slugify(e.title), 'event'),
           coalesce(app.slugify(s.role), 'crew')
             || '_' || coalesce(
                         app.slugify(split_part(btrim(coalesce(p.full_name, '')), ' ', 1)),
                         substr(replace(a.user_id::text, '-', ''), 1, 8)),
           p_kind::text)
    into v_dir
  from public.assignments a
  join public.slots s on s.id = a.slot_id
  join public.events e on e.id = s.event_id
  join public.organizations o on o.id = e.org_id
  left join public.clients c on c.id = e.client_id
  left join public.profiles p on p.user_id = a.user_id
  where a.id = p_assignment;

  if v_dir is null then
    raise exception 'assignment % not found', p_assignment using errcode = 'no_data_found';
  end if;

  v_ext := coalesce(substring(p_filename from '\.[A-Za-z0-9]{1,10}$'), '');
  v_base := left(p_filename, length(p_filename) - length(v_ext));
  v_key := v_dir || '/' || p_filename;

  while exists (select 1 from public.uploads u where u.storage_key = v_key) loop
    v_n := v_n + 1;
    v_key := v_dir || '/' || v_base || '-' || v_n || v_ext;
  end loop;

  return v_key;
end;
$$;

-- --------------------------------------------------------------------- start

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

comment on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) is
  'Authorizes an upload for the caller''s own assignment on a slot, derives the object key and writes the part ledger. Returns the plan the client uploads against. The caller then opens the multipart upload on R2 and records it with app.attach_multipart.';

-- ------------------------------------------------------------ attach to R2
-- Separate from start on purpose: authorize first, then spend an R2 call. The
-- other order leaves an orphaned multipart upload behind every refusal.

create or replace function app.attach_multipart(
  p_upload             uuid,
  p_multipart_upload_id text
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  if nullif(btrim(coalesce(p_multipart_upload_id, '')), '') is null then
    raise exception 'a multipart upload id is required' using errcode = 'check_violation';
  end if;

  select * into v_upload from public.uploads where id = p_upload for update;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  -- Idempotent (CLAUDE.md rule 8): the same id again is the same call.
  if v_upload.multipart_upload_id = p_multipart_upload_id then
    return v_upload;
  end if;

  if v_upload.multipart_upload_id is not null then
    raise exception 'upload % is already attached to multipart upload %',
      p_upload, v_upload.multipart_upload_id
      using errcode = 'check_violation';
  end if;

  if v_upload.status <> 'pending' then
    raise exception 'upload % is %, so a multipart upload cannot be attached',
      p_upload, v_upload.status
      using errcode = 'check_violation';
  end if;

  update public.uploads
     set multipart_upload_id = p_multipart_upload_id,
         status              = 'in_progress'
   where id = p_upload
  returning * into v_upload;

  return v_upload;
end;
$$;

-- ----------------------------------------------------------- the part ledger

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

comment on function public.record_upload_part(uuid, integer, text, text) is
  'Records a part R2 has accepted. Safe to call again for the same part: the latest ETag wins, which is what a retried part needs.';

-- What is left to send. The client calls this after a restart rather than
-- trusting its own notion of progress (PRD "How an upload works", step 2).
create or replace function public.upload_resume_plan(p_upload uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
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

-- ------------------------------------------------------------------ complete
-- Called only by the backend, because only the backend has seen R2's answer.
-- p_verified_* are what R2 reported for the finished object, not what the
-- client claims; the declaration they are checked against was written at
-- start and nothing since then can edit it from a client.

create or replace function app.complete_upload(
  p_upload            uuid,
  p_verified_bytes    bigint,
  p_verified_checksum text
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload   public.uploads;
  v_missing  integer;
  v_declared bigint;
  v_queued   integer := 0;
begin
  select * into v_upload from public.uploads where id = p_upload for update;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  -- Idempotent (CLAUDE.md rule 8). The completion call can arrive twice: a
  -- client retry, or R2's own retry of a webhook. The same answer is the same
  -- call; a different one means something is wrong and must not pass quietly.
  if v_upload.status = 'completed' then
    if v_upload.verified_bytes = p_verified_bytes
       and v_upload.verified_checksum = p_verified_checksum then
      return v_upload;
    end if;

    raise exception 'upload % is already completed with a different size or checksum', p_upload
      using errcode = 'check_violation';
  end if;

  if v_upload.status <> 'in_progress' then
    raise exception 'upload % is %, so it cannot be completed', p_upload, v_upload.status
      using errcode = 'check_violation';
  end if;

  -- ---- every part accounted for

  select count(*) into v_missing
  from public.upload_parts up
  where up.upload_id = p_upload and up.etag is null;

  if v_missing > 0 then
    raise exception 'upload % still has % part(s) outstanding', p_upload, v_missing
      using errcode = 'check_violation';
  end if;

  select sum(up.bytes) into v_declared
  from public.upload_parts up
  where up.upload_id = p_upload;

  if v_declared is distinct from v_upload.bytes then
    raise exception 'upload % has parts totalling % bytes but declared %',
      p_upload, v_declared, v_upload.bytes
      using errcode = 'check_violation';
  end if;

  -- ---- what R2 read back matches what was declared (CLAUDE.md rule 7)

  if p_verified_bytes is distinct from v_upload.bytes then
    raise exception 'upload % declared % bytes, R2 stored %',
      p_upload, v_upload.bytes, p_verified_bytes
      using errcode = 'check_violation';
  end if;

  if p_verified_checksum is distinct from v_upload.checksum then
    raise exception 'upload % declared checksum %, R2 computed %',
      p_upload, v_upload.checksum, p_verified_checksum
      using errcode = 'check_violation';
  end if;

  update public.uploads
     set status            = 'completed',
         verified_bytes    = p_verified_bytes,
         verified_checksum = p_verified_checksum,
         completed_at      = now()
   where id = p_upload
  returning * into v_upload;

  -- ---- connectors
  -- PRD "Footage pipeline → Connectors": copy on upload complete, for the
  -- scope the organization set. An approved-deliverables rule waits for
  -- approval, so nothing is queued for it here.

  insert into public.sync_jobs (org_id, upload_id, connector_account_id, status)
  select v_upload.org_id, v_upload.id, ca.id, 'queued'
  from public.connector_rules cr
  join public.connector_accounts ca on ca.id = cr.connector_account_id
  where cr.org_id = v_upload.org_id
    and cr.trigger_on = 'on_upload_complete'
    and ca.is_active
    and (cr.scope = 'both' or (cr.scope = 'raw' and v_upload.kind = 'raw'));

  get diagnostics v_queued = row_count;

  perform app.log_activity(
    v_upload.org_id, 'upload', v_upload.id, 'upload_completed',
    jsonb_build_object('assignment_id', v_upload.assignment_id,
                       'storage_key', v_upload.storage_key,
                       'bytes', v_upload.bytes,
                       'checksum', v_upload.checksum,
                       'sync_jobs_queued', v_queued));

  return v_upload;
end;
$$;

-- --------------------------------------------------------- abort and fail
-- An upload that stops has to stop in the record too, or the in-flight guard
-- below pins the assignment forever.

create or replace function app.abort_upload(p_upload uuid, p_reason text default null)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  select * into v_upload from public.uploads where id = p_upload for update;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  if v_upload.status = 'aborted' then
    return v_upload;
  end if;

  if v_upload.status <> all (array['pending', 'in_progress']::public.upload_status[]) then
    raise exception 'upload % is %, so it cannot be aborted', p_upload, v_upload.status
      using errcode = 'check_violation';
  end if;

  update public.uploads
     set status        = 'aborted',
         aborted_at    = now(),
         failed_reason = p_reason
   where id = p_upload
  returning * into v_upload;

  perform app.log_activity(
    v_upload.org_id, 'upload', v_upload.id, 'upload_aborted',
    jsonb_build_object('reason', p_reason, 'storage_key', v_upload.storage_key));

  return v_upload;
end;
$$;

-- The contractor cancelling their own upload, or a producer clearing one off
-- their event. The Edge Function then aborts the multipart upload on R2 so
-- the parts stop being billed.
create or replace function public.abort_upload(p_upload uuid, p_reason text default null)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
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

-- The backend's own failure path (rule 9): R2 refused, the multipart expired,
-- the completion did not verify. Distinct from aborted, which someone chose.
create or replace function app.fail_upload(p_upload uuid, p_reason text)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  select * into v_upload from public.uploads where id = p_upload for update;

  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;

  if v_upload.status = 'failed' then
    return v_upload;
  end if;

  if v_upload.status <> all (array['pending', 'in_progress']::public.upload_status[]) then
    raise exception 'upload % is %, so it cannot be failed', p_upload, v_upload.status
      using errcode = 'check_violation';
  end if;

  update public.uploads
     set status        = 'failed',
         failed_reason = p_reason
   where id = p_upload
  returning * into v_upload;

  perform app.log_activity(
    v_upload.org_id, 'upload', v_upload.id, 'upload_failed',
    jsonb_build_object('reason', p_reason, 'storage_key', v_upload.storage_key));

  return v_upload;
end;
$$;

-- ------------------------------------------- "Mark upload complete" is honest
-- PRD "Event lifecycle": Uploaded means "every slot has marked its upload
-- complete". A slot that claims it while bytes are still moving makes the
-- operations board lie, the same way a staffed event with an uncovered slot
-- does. This is a table trigger rather than a check inside
-- transition_assignment so it also holds for service_role and for any later
-- code path that moves an assignment.

create or replace function app.assignment_uploads_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_flight integer;
  v_completed integer;
begin
  select count(*) filter (where u.status in ('pending', 'in_progress')),
         count(*) filter (where u.status = 'completed')
    into v_in_flight, v_completed
  from public.uploads u
  where u.assignment_id = new.id;

  if v_in_flight > 0 then
    raise exception 'assignment % still has % upload(s) in flight', new.id, v_in_flight
      using errcode = 'check_violation',
            hint = 'Let the uploads finish, or abort them, before marking the slot uploaded.';
  end if;

  -- Zero files is not blocked: a contractor whose card went to the lead
  -- shooter would otherwise be stuck with no way out of the app. It is
  -- recorded instead, so the producer sees it on the board rather than
  -- discovering it at review.
  if v_completed = 0 then
    perform app.log_activity(
      new.org_id, 'assignment', new.id, 'uploaded_with_no_files',
      jsonb_build_object('slot_id', new.slot_id));
  end if;

  return new;
end;
$$;

create trigger assignments_uploads_settled
  before update of status on public.assignments
  for each row
  when (new.status = 'uploaded' and old.status <> 'uploaded')
  execute function app.assignment_uploads_settled();

-- -------------------------------------------------------------------- grants
-- The API roles reach the parts ledger read-only; everything that writes it
-- goes through the functions above, which is the same shape as uploads
-- itself (CLAUDE.md rule 7).

revoke all on public.upload_parts from anon, authenticated;
grant select on public.upload_parts to authenticated;

alter table public.upload_parts enable row level security;

-- Visibility follows the upload, which follows PRD "Permissions and data
-- visibility" row 7: owner all, producer their own events, contractor their
-- own uploads only.
create policy upload_parts_select_owner_producer_or_own on public.upload_parts
  for select to authenticated
  using (exists (
    select 1
    from public.uploads u
    where u.id = upload_parts.upload_id
      and (app.is_owner(u.org_id)
           or app.can_see_event_money_and_footage(app.assignment_event(u.assignment_id))
           or app.owns_assignment(u.assignment_id))
  ));

-- Client-callable.
revoke all on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) from public;
grant execute on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text)
  to authenticated, service_role;

revoke all on function public.record_upload_part(uuid, integer, text, text) from public;
grant execute on function public.record_upload_part(uuid, integer, text, text) to authenticated, service_role;

revoke all on function public.upload_resume_plan(uuid) from public;
grant execute on function public.upload_resume_plan(uuid) to authenticated, service_role;

revoke all on function public.abort_upload(uuid, text) from public;
grant execute on function public.abort_upload(uuid, text) to authenticated, service_role;

-- Backend only. The helper migration granted execute on everything in schema
-- app to authenticated, so these have to be taken back by name: a contractor
-- who could call complete_upload could declare their own verification.
revoke all on function app.complete_upload(uuid, bigint, text) from public, authenticated;
grant execute on function app.complete_upload(uuid, bigint, text) to service_role;

revoke all on function app.attach_multipart(uuid, text) from public, authenticated;
grant execute on function app.attach_multipart(uuid, text) to service_role;

revoke all on function app.fail_upload(uuid, text) from public, authenticated;
grant execute on function app.fail_upload(uuid, text) to service_role;

-- app.abort_upload has no ownership check of its own — public.abort_upload is
-- where that lives — so a client must not be able to reach it directly.
revoke all on function app.abort_upload(uuid, text) from public, authenticated;
grant execute on function app.abort_upload(uuid, text) to service_role;

revoke all on function app.upload_storage_key(uuid, public.upload_kind, text) from public, authenticated;
grant execute on function app.upload_storage_key(uuid, public.upload_kind, text) to service_role;
