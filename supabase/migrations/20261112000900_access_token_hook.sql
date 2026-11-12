-- Auth 3/3 — org roles in the access token.
--
-- The clients need to know which organizations a person belongs to and what
-- they are there, to render the organization switcher and the role-gated
-- screens (PRD "Users and roles", "Contractor app → Settings") without a
-- round trip on every screen.
--
-- Deliberately NOT used by RLS. The policies keep reading public.memberships,
-- so suspending or removing someone takes effect at once rather than when
-- their token next refreshes — which at the current jwt_expiry could be an
-- hour later. The claim is a convenience for the UI; the database remains the
-- authority. See docs/foundation-review.md.

create or replace function app.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_claims jsonb;
  v_roles  jsonb;
begin
  v_user := nullif(event ->> 'user_id', '')::uuid;
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- { "<org id>": ["owner", "producer"], "<org id>": ["contractor"] }
  select coalesce(jsonb_object_agg(per_org.org_id::text, per_org.roles), '{}'::jsonb)
    into v_roles
  from (
    select m.org_id, jsonb_agg(m.role::text order by m.role::text) as roles
    from public.memberships m
    where m.user_id = v_user
      and m.status = 'active'
    group by m.org_id
  ) as per_org;

  return jsonb_set(event, '{claims}', jsonb_set(v_claims, '{org_roles}', v_roles));
end;
$$;

comment on function app.custom_access_token(jsonb) is
  'Supabase access token hook: adds an org_roles claim naming the caller''s active memberships. For client UI only — RLS reads memberships directly so revocation is immediate.';

-- Only the auth server runs this. A client that could call it would learn
-- nothing it cannot read from memberships anyway, but there is no reason to
-- expose it.
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token(jsonb) from authenticated, anon, public;
