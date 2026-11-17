-- The files a client can download for one of their events: completed uploads
-- on approved or paid assignments, once the producer has released the event.
-- Clients cannot read assignments or slots (crew data), so this returns only
-- the file fields, and app.client_can_download applies the same test the
-- uploads policy and the footage-download function do.
create or replace function public.client_media(p_event uuid)
returns table (id uuid, filename text, bytes bigint, kind public.upload_kind, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.filename, u.bytes, u.kind, u.completed_at
  from public.uploads u
  join public.assignments a on a.id = u.assignment_id
  join public.slots s on s.id = a.slot_id
  where s.event_id = p_event
    and app.client_can_download(u.id)
  order by u.kind desc, u.filename;
$$;

revoke all on function public.client_media(uuid) from public, anon;
grant execute on function public.client_media(uuid) to authenticated;
