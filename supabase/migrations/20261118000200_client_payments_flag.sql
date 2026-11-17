-- Whether an organization takes card payments on client invoices. The
-- organizations table is owner-only, so the portal asks through this instead;
-- it says nothing else about the organization.
create or replace function public.client_payments_enabled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select o.client_payments_enabled
    from public.organizations o
    where o.id = p_org and app.is_member(o.id)
  ), false);
$$;

revoke all on function public.client_payments_enabled(uuid) from public, anon;
grant execute on function public.client_payments_enabled(uuid) to authenticated;
