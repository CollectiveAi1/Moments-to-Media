-- Security audit M1 (2026-11-19): anyone who signed up as a client could read
-- crew announcements.
--
-- app.is_member counts every active membership, and client sign-up makes an
-- active client membership straight away. The announcements policy used it,
-- so a stranger who signed up as a client read the crew's notices (gate
-- codes, call times). Compliance documents had the same gap on insert.
-- Both now name the roles that may use them.

drop policy announcements_select_member on public.announcements;
create policy announcements_select_member on public.announcements
  for select to authenticated
  using (
    app.is_admin(org_id)
    or (app.has_role(org_id, array['contractor']::public.org_role[])
        and (scheduled_for is null or scheduled_for <= now()))
  );

drop policy compliance_documents_insert_self on public.compliance_documents;
create policy compliance_documents_insert_self on public.compliance_documents
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and app.has_role(org_id, array['owner', 'producer', 'contractor']::public.org_role[])
    and status = any (array['pending', 'submitted']::public.compliance_status[])
  );

-- A new organization does not take sign-ups until its owner turns them on in
-- Settings. Existing organizations keep what they have.
alter table public.organizations alter column contractor_signup set default false;
alter table public.organizations alter column client_signup set default false;
