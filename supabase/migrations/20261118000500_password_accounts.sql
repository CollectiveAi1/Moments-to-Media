-- Email and password accounts with self sign-up (replaces invite-only,
-- link-only sign-in; Moments to Media asked for it on 2026-11-17 so people do
-- not have to be authorized one email at a time).
--
-- Who can sign up:
--   * contractors, into an organization that allows it. They start as a
--     *pending* member and see nothing until an owner or producer approves
--     them (approve_contractor). has_role / is_member only count 'active'.
--   * clients, into an organization that allows it. Once their email is
--     confirmed, they are attached to every client record that already lists
--     that email; otherwise they get an empty portal and the inquiry form.
--   * nobody signs up as an owner or producer. Those are still invited.
--
-- Trust: nothing here happens until the address is confirmed. The sign-up
-- intent rides in raw_user_meta_data (client-controlled), so it only ever
-- grants the least: a pending contractor, or a client of records that
-- already carry the confirmed email.

alter type public.membership_status add value if not exists 'pending';

alter table public.organizations
  add column contractor_signup boolean not null default true,
  add column client_signup     boolean not null default true;

grant update (contractor_signup, client_signup) on public.organizations to authenticated;

-- ---------------------------------------------- which orgs take sign-ups

create or replace function public.signup_orgs(p_role text)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug
  from public.organizations o
  where (p_role = 'contractor' and o.contractor_signup)
     or (p_role = 'client' and o.client_signup)
  order by o.name;
$$;

revoke all on function public.signup_orgs(text) from public;
grant execute on function public.signup_orgs(text) to anon, authenticated;

-- ------------------------------------- apply the sign-up after verification

create or replace function app.apply_signup(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  auth.users;
  v_role  text;
  v_org   public.organizations;
  v_email text;
  v_client record;
begin
  select * into v_user from auth.users where id = p_user;
  if not found or v_user.email_confirmed_at is null then
    return;
  end if;
  v_role := v_user.raw_user_meta_data ->> 'signup_role';
  if v_role is null or v_role not in ('contractor', 'client') then
    return;
  end if;
  select * into v_org from public.organizations
  where id = nullif(v_user.raw_user_meta_data ->> 'signup_org', '')::uuid;
  if not found then
    return;
  end if;
  v_email := lower(v_user.email);

  if v_role = 'contractor' and v_org.contractor_signup then
    insert into public.memberships (org_id, user_id, role, status)
    values (v_org.id, p_user, 'contractor', 'pending')
    on conflict (org_id, user_id, role) do nothing;
    if found then
      insert into public.notifications (org_id, user_id, type, channels, payload)
      select v_org.id, m.user_id, 'contractor_applied', '{in_app}',
             jsonb_build_object('user_id', p_user, 'email', v_email)
      from public.memberships m
      where m.org_id = v_org.id and m.status = 'active' and m.role in ('owner', 'producer');
      perform app.log_activity(v_org.id, 'membership', p_user, 'contractor_applied', '{}'::jsonb);
    end if;
  elsif v_role = 'client' and v_org.client_signup then
    insert into public.memberships (org_id, user_id, role, status)
    values (v_org.id, p_user, 'client', 'active')
    on conflict (org_id, user_id, role) do nothing;
    -- attach the login to every client that lists this confirmed email
    for v_client in
      select distinct c.client_id from public.client_contacts c
      where c.org_id = v_org.id and lower(c.email) = v_email
    loop
      if not exists (select 1 from public.client_contacts c where c.client_id = v_client.client_id and c.user_id = p_user) then
        update public.client_contacts c set user_id = p_user
        where c.id = (select c2.id from public.client_contacts c2
                      where c2.client_id = v_client.client_id and lower(c2.email) = v_email and c2.user_id is null
                      order by c2.is_primary desc, c2.created_at limit 1);
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function app.apply_signup(uuid) from public;

create or replace function app.apply_signup_on_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.email_confirmed_at is not null)
     or (tg_op = 'UPDATE' and old.email_confirmed_at is null and new.email_confirmed_at is not null) then
    perform app.apply_signup(new.id);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_verified_signup_insert
  after insert on auth.users
  for each row execute function app.apply_signup_on_verification();

create trigger on_auth_user_verified_signup_update
  after update of email_confirmed_at on auth.users
  for each row execute function app.apply_signup_on_verification();

-- A client who already had an account when their client record was made
-- (a proposal signed later) is attached on their next sign-in, through
-- claim_invitations' invitation. This catches records that carry their email
-- without an invitation: called by the app after every password sign-in.
create or replace function public.attach_client_records()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_n     integer := 0;
  v_row   record;
begin
  select lower(u.email) into v_email from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  for v_row in
    select distinct c.org_id, c.client_id
    from public.client_contacts c
    join public.memberships m on m.org_id = c.org_id and m.user_id = auth.uid() and m.role = 'client' and m.status = 'active'
    where lower(c.email) = v_email
      and not exists (select 1 from public.client_contacts x where x.client_id = c.client_id and x.user_id = auth.uid())
  loop
    update public.client_contacts c set user_id = auth.uid()
    where c.id = (select c2.id from public.client_contacts c2
                  where c2.client_id = v_row.client_id and lower(c2.email) = v_email and c2.user_id is null
                  order by c2.is_primary desc, c2.created_at limit 1);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.attach_client_records() from public, anon;
grant execute on function public.attach_client_records() to authenticated;

-- ----------------------------------------------------- approve contractors

create or replace function public.decide_contractor(p_membership uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if not found or not app.is_admin(v_m.org_id) then
    raise exception 'only the organization''s owners and producers can approve contractors'
      using errcode = 'insufficient_privilege';
  end if;
  if v_m.role <> 'contractor' or v_m.status::text <> 'pending' then
    raise exception 'this application was already decided' using errcode = 'check_violation';
  end if;
  if p_approve then
    update public.memberships set status = 'active' where id = p_membership;
  else
    delete from public.memberships where id = p_membership;
  end if;
  perform app.log_activity(v_m.org_id, 'membership', v_m.user_id,
    case when p_approve then 'contractor_approved' else 'contractor_declined' end, '{}'::jsonb);
end;
$$;

revoke all on function public.decide_contractor(uuid, boolean) from public, anon;
grant execute on function public.decide_contractor(uuid, boolean) to authenticated;

-- Applicants: admins see pending contractors' profiles to decide. A pending
-- member is not "in" the org for any other purpose.
create or replace function public.pending_contractors(p_org uuid)
returns table (membership_id uuid, user_id uuid, full_name text, email text, phone text,
               skills text[], home_base_label text, applied_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.user_id, p.full_name, p.email, p.phone, d.skills, d.home_base_label, m.created_at
  from public.memberships m
  join public.profiles p on p.user_id = m.user_id
  left join public.contractor_details d on d.user_id = m.user_id
  where m.org_id = p_org and m.role = 'contractor' and m.status::text = 'pending'
    and app.is_admin(p_org)
  order by m.created_at;
$$;

revoke all on function public.pending_contractors(uuid) from public, anon;
grant execute on function public.pending_contractors(uuid) to authenticated;
