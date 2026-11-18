-- Security audit H1 (2026-11-19): demo accounts could upload files of any
-- size to the footage bucket.
--
-- Demo mode signs any visitor in to shared accounts on the live database.
-- Those accounts could start real uploads, and nothing capped how much an
-- organization stores, so the bucket worked as free file hosting at the
-- studio's expense. Every upload path (start_crew_upload, start_studio_upload
-- and the start_upload dispatcher) inserts into public.uploads before R2 is
-- touched, so one guard on that insert covers all of them and a refusal never
-- leaves anything open in R2.

-- The fictional demo accounts all live under this reserved domain
-- (apps/admin/lib/demo.ts; .invalid can never receive mail).
create or replace function app.is_demo_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and lower(u.email) like '%@demo.moments-to-media.invalid'
  );
$$;

revoke all on function app.is_demo_account(uuid) from public;

-- How much an organization may hold in the footage bucket, counting every
-- upload that is not failed or aborted. 10 TiB is far above a season of
-- events; an owner who needs more asks for it, it is not self-service.
alter table public.organizations
  add column upload_quota_bytes bigint not null default 10995116277760
    check (upload_quota_bytes > 0);

create or replace function app.guard_new_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quota bigint;
  v_used  bigint;
begin
  if app.is_demo_account(auth.uid()) then
    raise exception 'uploads are off in the demo'
      using errcode = 'insufficient_privilege',
            hint = 'Demo accounts can look at uploads but not add files.';
  end if;

  -- One upload at a time per organization while the total is checked, so two
  -- uploads started together cannot both squeeze under the quota.
  perform pg_advisory_xact_lock(hashtextextended('upload_quota:' || new.org_id::text, 0));
  select o.upload_quota_bytes into v_quota from public.organizations o where o.id = new.org_id;
  select coalesce(sum(u.bytes), 0) into v_used
  from public.uploads u
  where u.org_id = new.org_id and u.status not in ('failed', 'aborted');

  if v_used + new.bytes > v_quota then
    raise exception 'this upload would take the organization over its % GB storage quota', v_quota / 1073741824
      using errcode = 'check_violation',
            hint = 'Delete old uploads or ask for a larger quota.';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_new_upload() from public;

create trigger uploads_guard_new
  before insert on public.uploads
  for each row execute function app.guard_new_upload();
