-- Auth 2/3 — invitations, which are how an account comes into being.
--
-- PRD "Scope and phases" puts self-serve signup in v2, and PRD "Risks" says
-- contractors arrive by "invite by SMS link with passwordless sign-in". So
-- there is no sign-up path that is not an invitation, and the invitation is
-- what binds a new login to an organization and a role.
--
-- An invitation is matched on a verified email or phone. Supabase has already
-- proved the person controls that address by the time either claim path runs
-- — that is what makes matching on it safe.

create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  role        public.org_role not null,
  email       text,
  phone       text,
  invited_by  uuid not null references auth.users (id) on delete restrict,
  status      public.invitation_status not null default 'pending',
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint org_invitations_needs_an_identity check (
    nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  ),
  constraint org_invitations_accepted_fields check (
    (status = 'accepted') = (accepted_by is not null)
  )
);

create index org_invitations_org_id_idx on public.org_invitations (org_id);
create index org_invitations_invited_by_idx on public.org_invitations (invited_by);
create index org_invitations_accepted_by_idx on public.org_invitations (accepted_by);
-- The claim path looks an invitation up by identity, not by organization.
create index org_invitations_pending_email_idx on public.org_invitations (lower(email))
  where status = 'pending' and email is not null;
create index org_invitations_pending_phone_idx on public.org_invitations (phone)
  where status = 'pending' and phone is not null;

-- One live invitation per person per organization.
create unique index org_invitations_one_pending_email
  on public.org_invitations (org_id, lower(email))
  where status = 'pending' and email is not null;
create unique index org_invitations_one_pending_phone
  on public.org_invitations (org_id, phone)
  where status = 'pending' and phone is not null;

create trigger org_invitations_touch
  before update on public.org_invitations
  for each row execute function app.touch_updated_at();

-- Identities are normalised on the way in so matching never depends on how
-- the producer typed it.
create or replace function app.normalise_invitation_identity()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(nullif(btrim(coalesce(new.email, '')), ''));
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  return new;
end;
$$;

create trigger org_invitations_normalise
  before insert or update on public.org_invitations
  for each row execute function app.normalise_invitation_identity();

-- ---------------------------------------------------------------- claiming

-- Binds every pending invitation that matches this user's *verified* contact
-- details. Returns how many were accepted.
create or replace function app.claim_invitations_for(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_phone       text;
  v_invitation  record;
  v_claimed     integer := 0;
begin
  if p_user is null then
    return 0;
  end if;

  select
    case when u.email_confirmed_at is not null
         then lower(nullif(btrim(coalesce(u.email, '')), '')) end,
    case when u.phone_confirmed_at is not null
         then nullif(btrim(coalesce(u.phone, '')), '') end
    into v_email, v_phone
  from auth.users u
  where u.id = p_user;

  if not found then
    raise exception 'user % not found', p_user using errcode = 'no_data_found';
  end if;

  -- Nothing verified yet: the magic link has not been followed, or the OTP
  -- has not been entered. Claiming now would burn the invitation for someone
  -- who has not proved they own the address.
  if v_email is null and v_phone is null then
    return 0;
  end if;

  for v_invitation in
    select i.*
    from public.org_invitations i
    where i.status = 'pending'
      and i.expires_at > now()
      and (
        (i.email is not null and v_email is not null and i.email = v_email)
        or (i.phone is not null and v_phone is not null and i.phone = v_phone)
      )
    order by i.created_at
    for update
  loop
    insert into public.memberships (org_id, user_id, role, status)
    values (v_invitation.org_id, p_user, v_invitation.role, 'active')
    on conflict (org_id, user_id, role) do update set status = 'active';

    update public.org_invitations
       set status = 'accepted', accepted_by = p_user, accepted_at = now()
     where id = v_invitation.id;

    perform app.log_activity(
      v_invitation.org_id, 'membership', p_user, 'invitation_accepted',
      jsonb_build_object('role', v_invitation.role, 'invitation_id', v_invitation.id)
    );

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

-- A brand-new user whose address is already verified at insert, and the
-- ordinary case where verification lands on a later update.
create or replace function app.claim_invitations_on_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.email_confirmed_at is not null or new.phone_confirmed_at is not null then
      perform app.claim_invitations_for(new.id);
    end if;
  elsif (old.email_confirmed_at is null and new.email_confirmed_at is not null)
     or (old.phone_confirmed_at is null and new.phone_confirmed_at is not null) then
    perform app.claim_invitations_for(new.id);
  end if;

  return new;
end;
$$;

-- Fires after the profile trigger, which the memberships rows do not depend
-- on but the admin console's directory does.
create trigger on_auth_user_verified_insert
  after insert on auth.users
  for each row execute function app.claim_invitations_on_verification();

create trigger on_auth_user_verified_update
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row execute function app.claim_invitations_on_verification();

-- The second-organization case: an existing login is invited elsewhere, so no
-- auth.users row changes and no trigger fires. The app calls this after
-- sign-in (PRD "Users and roles": one login, several organizations).
create or replace function public.claim_invitations()
returns integer
language sql
security definer
set search_path = ''
as $$
  select app.claim_invitations_for(auth.uid());
$$;

comment on function public.claim_invitations() is
  'Accepts any pending invitation matching the caller''s verified email or phone, and returns how many. Safe to call on every sign-in: it is idempotent.';

revoke all on function public.claim_invitations() from public;
grant execute on function public.claim_invitations() to authenticated;
revoke all on function app.claim_invitations_for(uuid) from public;
grant execute on function app.claim_invitations_for(uuid) to service_role;

-- -------------------------------------------------------------------- RLS
-- PRD "Users and roles": the owner manages admins, so only an owner may
-- invite one. A producer staffs their events, so a producer may invite
-- contractors and nothing else.

alter table public.org_invitations enable row level security;

-- Supabase's default privileges grant the API roles everything on each new
-- table in public, which is how this one arrived with seven privileges for
-- anon and a full-table UPDATE for authenticated that would have made the
-- column-level grant below meaningless. Take it back for this table, and
-- stop the default applying to tables added later — 01_schema_conventions
-- fails the build if either slips.
revoke all on public.org_invitations from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select, insert, delete on public.org_invitations to authenticated;
-- status is writable so an admin can revoke; the check below stops a client
-- writing 'accepted', which only the claim path may do.
grant update (status, role, expires_at) on public.org_invitations to authenticated;

create policy org_invitations_select_admin on public.org_invitations
  for select to authenticated
  using (app.is_admin(org_id));

create policy org_invitations_insert_admin on public.org_invitations
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and status = 'pending'
    and case
          when role = 'contractor' then app.is_admin(org_id)
          else app.is_owner(org_id)
        end
  );

create policy org_invitations_update_admin on public.org_invitations
  for update to authenticated
  using (app.is_admin(org_id))
  with check (app.is_admin(org_id) and status in ('pending', 'revoked', 'expired'));

create policy org_invitations_delete_owner on public.org_invitations
  for delete to authenticated
  using (app.is_owner(org_id));
