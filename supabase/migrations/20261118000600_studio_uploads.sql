-- Studio uploads: Moments to Media delivers finished files to a client's
-- project directly, not through a crew member's assignment. Same pipeline as
-- crew uploads (presigned multipart straight to R2, CRC-64/NVME verified on
-- completion; CLAUDE.md rule 7), so an upload now belongs to either an
-- assignment (crew) or an event (studio), never both.
--
-- Who: the event's producer or an owner (app.can_manage_event).
-- The client sees a studio file once it is complete and the project's media
-- has been released, through the same app.client_can_download test.

alter table public.uploads alter column assignment_id drop not null;

alter table public.uploads
  add column event_id    uuid references public.events (id) on delete cascade,
  add column uploaded_by uuid references auth.users (id) on delete set null;

create index uploads_event_id_idx on public.uploads (event_id);
create index uploads_uploaded_by_idx on public.uploads (uploaded_by);

alter table public.uploads
  add constraint uploads_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.uploads
  add constraint uploads_one_owner check ((assignment_id is null) <> (event_id is null));

-- --------------------------------------------------------------- helpers

create or replace function app.upload_event(p_upload uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.event_id, s.event_id)
  from public.uploads u
  left join public.assignments a on a.id = u.assignment_id
  left join public.slots s on s.id = a.slot_id
  where u.id = p_upload;
$$;

-- The person who may write parts to an upload: the contractor whose
-- assignment it is, or for a studio upload, whoever manages the event.
create or replace function app.may_write_upload(p_upload uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.assignment_id is not null then app.owns_assignment(u.assignment_id)
              else app.can_manage_event(u.event_id) end
  from public.uploads u where u.id = p_upload;
$$;

create or replace function app.studio_storage_key(p_event uuid, p_kind public.upload_kind, p_filename text)
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
  select concat_ws('/',
           app.slugify(o.slug),
           coalesce(app.slugify(c.name), 'internal'),
           to_char((e.starts_at at time zone e.time_zone)::date, 'YYYY-MM-DD') || '_' || coalesce(app.slugify(e.title), 'event'),
           'studio',
           p_kind::text)
    into v_dir
  from public.events e
  join public.organizations o on o.id = e.org_id
  left join public.clients c on c.id = e.client_id
  where e.id = p_event;
  if v_dir is null then
    raise exception 'event % not found', p_event using errcode = 'no_data_found';
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

-- ------------------------------------------------------------ start

create or replace function public.start_studio_upload(
  p_event_id           uuid,
  p_filename           text,
  p_bytes              bigint,
  p_checksum           text,
  p_kind               public.upload_kind default 'deliverables',
  p_part_size_bytes    bigint default null,
  p_checksum_algorithm text default 'crc64nvme'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event      public.events;
  v_upload     public.uploads;
  v_part_size  bigint;
  v_part_count integer;
  v_attempt    integer := 0;
begin
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers' using errcode = 'insufficient_privilege';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or not app.can_manage_event(p_event_id) then
    raise exception 'only this event''s producer or an owner can deliver files to its client'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'raw' then
    raise exception 'studio deliveries are final edits or selects' using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_filename, '')), '') is null then
    raise exception 'an upload needs a filename' using errcode = 'check_violation';
  end if;
  if p_filename ~ '[/\\]' or p_filename ~ '^\.' or length(p_filename) > 255 then
    raise exception 'filename % is not usable as an object key', p_filename
      using errcode = 'check_violation', hint = 'No slashes or backslashes, no leading dot, 255 characters or fewer.';
  end if;
  if p_bytes is null or p_bytes <= 0 then
    raise exception 'an upload needs a positive size, got %', p_bytes using errcode = 'check_violation';
  end if;
  if p_bytes > 5497558138880 then
    raise exception 'upload of % bytes is over the 5 TiB object limit', p_bytes using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_checksum, '')), '') is null then
    raise exception 'an upload must declare its checksum before it starts' using errcode = 'check_violation';
  end if;

  v_part_size := coalesce(p_part_size_bytes, app.plan_part_size(p_bytes));
  v_part_count := ceil(p_bytes::numeric / v_part_size);
  if v_part_count > 10000 then
    raise exception 'a part size of % bytes needs % parts, over the 10000 limit', v_part_size, v_part_count using errcode = 'check_violation';
  end if;
  if v_part_count > 1 and v_part_size < 5242880 then
    raise exception 'a part size of % bytes is under the 5 MiB minimum', v_part_size using errcode = 'check_violation';
  end if;
  if v_part_size > 5368709120 then
    raise exception 'a part size of % bytes is over the 5 GiB maximum', v_part_size using errcode = 'check_violation';
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.uploads
        (org_id, event_id, uploaded_by, kind, storage_key, filename, bytes, checksum,
         checksum_algorithm, part_size_bytes, part_count, status)
      values
        (v_event.org_id, v_event.id, auth.uid(), p_kind,
         app.studio_storage_key(v_event.id, p_kind, p_filename),
         p_filename, p_bytes, p_checksum, p_checksum_algorithm, v_part_size, v_part_count, 'pending')
      returning * into v_upload;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  insert into public.upload_parts (org_id, upload_id, part_number, bytes)
  select v_upload.org_id, v_upload.id, n, least(v_part_size, p_bytes - (n - 1)::bigint * v_part_size)
  from generate_series(1, v_part_count) as n;

  perform app.log_activity(v_upload.org_id, 'upload', v_upload.id, 'studio_upload_started',
    jsonb_build_object('event_id', v_event.id, 'filename', p_filename, 'bytes', p_bytes, 'part_count', v_part_count));

  return jsonb_build_object(
    'upload_id', v_upload.id, 'storage_key', v_upload.storage_key, 'status', v_upload.status,
    'bytes', v_upload.bytes, 'checksum', v_upload.checksum, 'checksum_algorithm', v_upload.checksum_algorithm,
    'part_size_bytes', v_part_size, 'part_count', v_part_count,
    'parts', (select jsonb_agg(jsonb_build_object('part_number', up.part_number, 'bytes', up.bytes) order by up.part_number)
              from public.upload_parts up where up.upload_id = v_upload.id));
end;
$$;

revoke all on function public.start_studio_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) from public, anon;
grant execute on function public.start_studio_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) to authenticated;

-- ------------------------------------- the per-upload checks learn about studio uploads

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
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers' using errcode = 'insufficient_privilege';
  end if;
  select * into v_upload from public.uploads where id = p_upload;
  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null and not app.may_write_upload(p_upload) then
    raise exception 'upload % does not belong to you', p_upload using errcode = 'insufficient_privilege';
  end if;
  if v_upload.status <> 'in_progress' then
    raise exception 'upload % is %, so parts cannot be recorded', p_upload, v_upload.status using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_etag, '')), '') is null then
    raise exception 'a part needs the ETag R2 returned' using errcode = 'check_violation';
  end if;
  update public.upload_parts
     set etag = p_etag, checksum = coalesce(p_checksum, checksum), uploaded_at = clock_timestamp()
   where upload_id = p_upload and part_number = p_part_number;
  if not found then
    raise exception 'upload % has no part %', p_upload, p_part_number using errcode = 'no_data_found';
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
  select * into v_upload from public.uploads where id = p_upload;
  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null
     and not app.may_write_upload(p_upload)
     and not app.is_owner(v_upload.org_id)
     and not app.can_see_event_money_and_footage(app.upload_event(p_upload))
  then
    raise exception 'upload % does not belong to you', p_upload using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'upload_id', v_upload.id,
    'status', v_upload.status,
    'storage_key', v_upload.storage_key,
    'multipart_upload_id', v_upload.multipart_upload_id,
    'bytes', v_upload.bytes,
    'checksum', v_upload.checksum,
    'checksum_algorithm', v_upload.checksum_algorithm,
    'part_size_bytes', v_upload.part_size_bytes,
    'part_count', v_upload.part_count,
    'bytes_received', coalesce((select sum(up.bytes) from public.upload_parts up where up.upload_id = p_upload and up.etag is not null), 0),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number, 'bytes', up.bytes) order by up.part_number)
                           from public.upload_parts up where up.upload_id = p_upload and up.etag is null), '[]'::jsonb),
    'landed', coalesce((select jsonb_agg(jsonb_build_object('part_number', up.part_number, 'etag', up.etag, 'checksum', up.checksum) order by up.part_number)
                          from public.upload_parts up where up.upload_id = p_upload and up.etag is not null), '[]'::jsonb));
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
  if app.caller_is_anonymous() then
    raise exception 'this function is not open to anonymous callers' using errcode = 'insufficient_privilege';
  end if;
  select * into v_upload from public.uploads where id = p_upload;
  if not found then
    raise exception 'upload % not found', p_upload using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null
     and not app.may_write_upload(p_upload)
     and not app.can_manage_event(app.upload_event(p_upload))
  then
    raise exception 'upload % is not yours to abort', p_upload using errcode = 'insufficient_privilege';
  end if;
  return app.abort_upload(p_upload, p_reason);
end;
$$;

-- ---------------------------------------------------- who can see the rows

drop policy if exists uploads_select_owner_producer_or_own on public.uploads;
create policy uploads_select_owner_producer_or_own on public.uploads
  for select to authenticated
  using (
    app.is_owner(org_id)
    or app.can_see_event_money_and_footage(app.upload_event(id))
    or (assignment_id is not null and app.owns_assignment(assignment_id))
  );

create or replace function app.client_can_download(p_upload uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.uploads u
    left join public.assignments a on a.id = u.assignment_id
    join public.media_releases r on r.event_id = app.upload_event(u.id)
    where u.id = p_upload
      and u.status = 'completed'
      and (u.event_id is not null or a.status in ('approved', 'paid'))
      and app.client_owns_event(r.event_id)
  );
$$;

create or replace function public.client_media(p_event uuid)
returns table (id uuid, filename text, bytes bigint, kind public.upload_kind, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.filename, u.bytes, u.kind, u.completed_at
  from public.uploads u
  left join public.assignments a on a.id = u.assignment_id
  left join public.slots s on s.id = a.slot_id
  where coalesce(u.event_id, s.event_id) = p_event
    and app.client_can_download(u.id)
  order by u.kind desc, u.filename;
$$;

-- Releasing needs something to release: approved crew footage or a
-- finished studio upload.
create or replace function public.release_media(p_event uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if not found or not app.can_manage_event(p_event) then
    raise exception 'only this event''s producer or an owner can release media' using errcode = 'insufficient_privilege';
  end if;
  if v_event.client_id is null then
    raise exception 'set the event''s client before releasing media' using errcode = 'check_violation';
  end if;
  if not exists (
       select 1 from public.uploads u
       join public.assignments a on a.id = u.assignment_id
       join public.slots s on s.id = a.slot_id
       where s.event_id = p_event and u.status = 'completed' and a.status in ('approved', 'paid'))
     and not exists (select 1 from public.uploads u where u.event_id = p_event and u.status = 'completed') then
    raise exception 'upload a finished file or approve a contractor''s footage first' using errcode = 'check_violation';
  end if;

  insert into public.media_releases (org_id, event_id, released_by, message)
  values (v_event.org_id, p_event, auth.uid(), nullif(btrim(coalesce(p_message, '')), ''))
  on conflict (event_id) do update set message = excluded.message, released_at = now(), released_by = excluded.released_by;

  insert into public.notifications (org_id, user_id, type, channels, payload)
  select v_event.org_id, c.user_id, 'media_ready', '{in_app}', jsonb_build_object('event_id', p_event, 'event_title', v_event.title)
  from public.client_contacts c where c.client_id = v_event.client_id and c.user_id is not null;

  perform app.log_activity(v_event.org_id, 'event', p_event, 'media_released', '{}'::jsonb);
end;
$$;

-- A studio upload can be removed by whoever manages the event, before or
-- after release (the R2 object is left for the lifecycle rule).
create or replace function public.remove_studio_upload(p_upload uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads;
begin
  select * into v_upload from public.uploads where id = p_upload;
  if not found or v_upload.event_id is null or not app.can_manage_event(v_upload.event_id) then
    raise exception 'only this event''s producer or an owner can remove a delivered file' using errcode = 'insufficient_privilege';
  end if;
  delete from public.upload_parts where upload_id = p_upload;
  delete from public.uploads where id = p_upload;
  perform app.log_activity(v_upload.org_id, 'upload', p_upload, 'studio_upload_removed', jsonb_build_object('filename', v_upload.filename));
end;
$$;

revoke all on function public.remove_studio_upload(uuid) from public, anon;
grant execute on function public.remove_studio_upload(uuid) to authenticated;
revoke all on function app.upload_event(uuid), app.may_write_upload(uuid), app.studio_storage_key(uuid, public.upload_kind, text) from public;
grant execute on function app.upload_event(uuid) to authenticated, service_role;
