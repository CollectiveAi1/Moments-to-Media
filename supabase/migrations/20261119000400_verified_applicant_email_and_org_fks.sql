-- Security audit L4 and L5 (2026-11-19).

-- L4: the applicant list showed the email from profiles, which its owner can
-- edit, so an applicant could appear to be someone else. It now shows the
-- address they signed up and verified with.
create or replace function public.pending_contractors(p_org uuid)
returns table (membership_id uuid, user_id uuid, full_name text, email text, phone text,
               skills text[], home_base_label text, applied_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.user_id, p.full_name, lower(u.email), p.phone, d.skills, d.home_base_label, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  join public.profiles p on p.user_id = m.user_id
  left join public.contractor_details d on d.user_id = m.user_id
  where m.org_id = p_org and m.role = 'contractor' and m.status::text = 'pending'
    and app.is_admin(p_org)
  order by m.created_at;
$$;

-- L5: six references were checked against the other table's id only, not that
-- it belongs to the same organization (CLAUDE.md rule 1). Each now also
-- matches org_id. On delete, only the reference is cleared, never org_id.
alter table public.invoices
  add constraint invoices_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete set null (event_id);

alter table public.leads
  add constraint leads_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete set null (client_id),
  add constraint leads_package_same_org_fkey
  foreign key (package_id, org_id) references public.packages (id, org_id) on delete set null (package_id);

alter table public.proposals
  add constraint proposals_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete restrict,
  add constraint proposals_lead_same_org_fkey
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete set null (lead_id);

alter table public.proposal_items
  add constraint proposal_items_package_same_org_fkey
  foreign key (package_id, org_id) references public.packages (id, org_id) on delete set null (package_id);
