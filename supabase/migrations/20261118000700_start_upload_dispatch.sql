-- The upload-start Edge Function calls public.start_upload with a slot id.
-- Studio deliveries pass the event id in that same field, so the deployed
-- function (and every client that already speaks its protocol) needs no
-- change: start_upload now dispatches. The crew path is the original
-- function, renamed, unchanged.

alter function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text)
  rename to start_crew_upload;

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
begin
  if exists (select 1 from public.slots where id = p_slot_id) then
    return public.start_crew_upload(p_slot_id, p_filename, p_bytes, p_checksum, p_kind, p_part_size_bytes, p_checksum_algorithm);
  end if;
  if exists (select 1 from public.events where id = p_slot_id) then
    return public.start_studio_upload(p_slot_id, p_filename, p_bytes, p_checksum,
      case when p_kind = 'raw' then 'deliverables'::public.upload_kind else p_kind end,
      p_part_size_bytes, p_checksum_algorithm);
  end if;
  raise exception 'nothing to upload to: % is not a slot or an event', p_slot_id using errcode = 'no_data_found';
end;
$$;

comment on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) is
  'Starts an upload. A slot id is a crew upload (public.start_crew_upload); an event id is a studio delivery to the client (public.start_studio_upload).';

revoke all on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) from public, anon;
grant execute on function public.start_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) to authenticated;
revoke all on function public.start_crew_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) from public, anon;
grant execute on function public.start_crew_upload(uuid, text, bigint, text, public.upload_kind, bigint, text) to authenticated;
