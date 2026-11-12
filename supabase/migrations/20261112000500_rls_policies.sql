-- Foundation 5/6 — grants and row-level security.
--
-- Specification: PRD "Permissions and data visibility" (the 11-row matrix) and
-- CLAUDE.md rules 1, 2 and 6. Every table in this schema gets RLS enabled and
-- explicit policies; supabase/tests covers each matrix cell, allowed and denied.
--
-- Two mechanisms work together:
--   * policies decide which ROWS a role may touch;
--   * column grants decide which COLUMNS may be written. Status columns are
--     left out of every update grant, so a client cannot move a state machine
--     by writing to it — only transition_event / transition_assignment /
--     transition_payout can (CLAUDE.md rule 6).
--
-- Supabase's own default privileges grant the API roles broad access to new
-- tables, so the first thing this migration does is take that away.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- anon never reads application data: every client signs in first
-- (passwordless SMS or email link), so no policy below mentions anon.

alter table public.organizations        enable row level security;
alter table public.memberships          enable row level security;
alter table public.profiles             enable row level security;
alter table public.contractor_details   enable row level security;
alter table public.equipment            enable row level security;
alter table public.availability         enable row level security;
alter table public.compliance_documents enable row level security;
alter table public.clients              enable row level security;
alter table public.client_contacts      enable row level security;
alter table public.events               enable row level security;
alter table public.event_contacts       enable row level security;
alter table public.briefs               enable row level security;
alter table public.slots                enable row level security;
alter table public.assignments          enable row level security;
alter table public.shot_list_items      enable row level security;
alter table public.shot_checks          enable row level security;
alter table public.deliverables         enable row level security;
alter table public.deliverable_reviews  enable row level security;
alter table public.uploads              enable row level security;
alter table public.connector_accounts   enable row level security;
alter table public.connector_rules      enable row level security;
alter table public.sync_jobs            enable row level security;
alter table public.payouts              enable row level security;
alter table public.ratings              enable row level security;
alter table public.announcements        enable row level security;
alter table public.notifications        enable row level security;
alter table public.activity_log         enable row level security;

-- ====================================================== organizations (row 11)
-- Owner only. Everyone else reads name and branding through
-- public.organization_public. stripe_account_id is not writable from a client.

grant select on public.organizations to authenticated;
grant update (name, slug, branding, in_app_payments_enabled, settings)
  on public.organizations to authenticated;

create policy organizations_select_owner on public.organizations
  for select to authenticated
  using (app.is_owner(id));

create policy organizations_update_owner on public.organizations
  for update to authenticated
  using (app.is_owner(id))
  with check (app.is_owner(id));

-- ================================================================ memberships
-- Roles and admins are owner business. Everyone may see their own rows so the
-- clients know which organizations to offer in the switcher.

grant select, insert, delete on public.memberships to authenticated;
grant update (role, status) on public.memberships to authenticated;

create policy memberships_select_self_or_admin on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin(org_id));

create policy memberships_insert_owner on public.memberships
  for insert to authenticated
  with check (app.is_owner(org_id));

create policy memberships_update_owner on public.memberships
  for update to authenticated
  using (app.is_owner(org_id))
  with check (app.is_owner(org_id));

create policy memberships_delete_owner on public.memberships
  for delete to authenticated
  using (app.is_owner(org_id));

-- =============================================== contractor profiles (row 8)
-- "Own only" for contractors at every slot standing; admins of organizations
-- the person belongs to see all. Crew phone numbers for a confirmed crew mate
-- come from public.event_crew, not from here.

grant select, insert on public.profiles to authenticated;
grant update (full_name, phone, email, photo_path, bio, portfolio_links)
  on public.profiles to authenticated;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or app.shares_org_as_admin(user_id));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert on public.contractor_details to authenticated;
-- stripe_account_id / stripe_payouts_enabled are set by the Stripe onboarding
-- callback with the service role, never by the app.
grant update (skills, home_base_label, home_base_latitude, home_base_longitude,
              travel_radius_miles, default_rate_cents)
  on public.contractor_details to authenticated;

create policy contractor_details_select_self_or_admin on public.contractor_details
  for select to authenticated
  using (user_id = auth.uid() or app.shares_org_as_admin(user_id));

create policy contractor_details_insert_self on public.contractor_details
  for insert to authenticated
  with check (user_id = auth.uid());

create policy contractor_details_update_self on public.contractor_details
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.equipment to authenticated;
grant update (category, make, model) on public.equipment to authenticated;

create policy equipment_select_self_or_admin on public.equipment
  for select to authenticated
  using (user_id = auth.uid() or app.shares_org_as_admin(user_id));

create policy equipment_write_self on public.equipment
  for insert to authenticated
  with check (user_id = auth.uid());

create policy equipment_update_self on public.equipment
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy equipment_delete_self on public.equipment
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.availability to authenticated;
grant update (starts_on, ends_on, is_available, recurrence_days)
  on public.availability to authenticated;

create policy availability_select_self_or_admin on public.availability
  for select to authenticated
  using (user_id = auth.uid() or app.shares_org_as_admin(user_id));

create policy availability_insert_self on public.availability
  for insert to authenticated
  with check (user_id = auth.uid());

create policy availability_update_self on public.availability
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy availability_delete_self on public.availability
  for delete to authenticated
  using (user_id = auth.uid());

-- ===================================================== compliance documents
-- The contractor submits; only an admin approves, rejects or expires one, so
-- status is granted but the policy restricts updates to admins.

grant select, insert, delete on public.compliance_documents to authenticated;
grant update (doc_type, status, file_path, expires_on)
  on public.compliance_documents to authenticated;

create policy compliance_documents_select_self_or_admin on public.compliance_documents
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin(org_id));

create policy compliance_documents_insert_self on public.compliance_documents
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and app.is_member(org_id)
    and status = any (array['pending', 'submitted']::public.compliance_status[])
  );

create policy compliance_documents_update_admin on public.compliance_documents
  for update to authenticated
  using (app.is_admin(org_id))
  with check (app.is_admin(org_id));

create policy compliance_documents_delete_self_unapproved on public.compliance_documents
  for delete to authenticated
  using (user_id = auth.uid() and status <> 'approved');

-- ====================================================== clients (row 3 part)

grant select, insert, delete on public.clients to authenticated;
grant update (name) on public.clients to authenticated;

create policy clients_select_admin on public.clients
  for select to authenticated
  using (app.is_admin(org_id));

create policy clients_insert_admin on public.clients
  for insert to authenticated
  with check (app.is_admin(org_id));

create policy clients_update_admin on public.clients
  for update to authenticated
  using (app.is_admin(org_id))
  with check (app.is_admin(org_id));

create policy clients_delete_owner on public.clients
  for delete to authenticated
  using (app.is_owner(org_id));

-- Row 3: "Client and on-site contact" — admins always, a contractor only once
-- confirmed on an event for that client.
grant select, insert, delete on public.client_contacts to authenticated;
grant update (name, phone, email, is_primary) on public.client_contacts to authenticated;

create policy client_contacts_select_admin_or_confirmed on public.client_contacts
  for select to authenticated
  using (
    app.is_admin(org_id)
    or exists (
      select 1
      from public.events e
      where e.client_id = client_contacts.client_id
        and app.packet_visible(e.id)
    )
  );

create policy client_contacts_insert_admin on public.client_contacts
  for insert to authenticated
  with check (app.is_admin(org_id));

create policy client_contacts_update_admin on public.client_contacts
  for update to authenticated
  using (app.is_admin(org_id))
  with check (app.is_admin(org_id));

create policy client_contacts_delete_admin on public.client_contacts
  for delete to authenticated
  using (app.is_admin(org_id));

-- ============================================================ events (row 2)
-- The row holds the exact address, arrival and parking notes, so a contractor
-- reaches it only once the packet is unlocked. Candidates get the coarse
-- fields from public.job_board instead. status, completed_at and cancelled_at
-- are deliberately absent from the update grant.

grant select, insert, delete on public.events to authenticated;
grant update (client_id, producer_id, title, starts_at, ends_at, time_zone,
              area_label, venue_name, address, latitude, longitude,
              check_in_radius_m, arrival_notes, parking_notes, dress_code)
  on public.events to authenticated;

create policy events_select_admin_or_confirmed on public.events
  for select to authenticated
  using (app.is_admin(org_id) or app.packet_visible(id));

create policy events_insert_admin on public.events
  for insert to authenticated
  with check (
    status = 'draft'
    and (
      app.is_owner(org_id)
      or (app.has_role(org_id, array['producer']::public.org_role[]) and producer_id = auth.uid())
    )
  );

create policy events_update_manager on public.events
  for update to authenticated
  using (app.can_manage_event(id))
  with check (app.can_manage_event(id));

create policy events_delete_draft on public.events
  for delete to authenticated
  using (app.can_manage_event(id) and status = 'draft');

-- ================================================== event contacts (row 6)
-- Emergency and on-site contacts: packet data.

grant select, insert, delete on public.event_contacts to authenticated;
grant update (kind, name, phone) on public.event_contacts to authenticated;

create policy event_contacts_select_admin_or_confirmed on public.event_contacts
  for select to authenticated
  using (app.is_admin(org_id) or app.packet_visible(event_id));

create policy event_contacts_insert_manager on public.event_contacts
  for insert to authenticated
  with check (app.can_manage_event(event_id));

create policy event_contacts_update_manager on public.event_contacts
  for update to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

create policy event_contacts_delete_manager on public.event_contacts
  for delete to authenticated
  using (app.can_manage_event(event_id));

-- ============================================================ briefs (row 4)
-- The body is packet data. A candidate reads briefs.summary — and only the
-- summary — through public.job_board.

grant select, insert, delete on public.briefs to authenticated;
grant update (summary, body, attachments) on public.briefs to authenticated;

create policy briefs_select_admin_or_confirmed on public.briefs
  for select to authenticated
  using (app.is_admin(org_id) or app.packet_visible(event_id));

create policy briefs_insert_manager on public.briefs
  for insert to authenticated
  with check (app.can_manage_event(event_id));

create policy briefs_update_manager on public.briefs
  for update to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

create policy briefs_delete_manager on public.briefs
  for delete to authenticated
  using (app.can_manage_event(event_id));

-- ============================================================= slots (row 1)
-- A slot row carries role, rate, required gear and call time: exactly the
-- fields row 1 allows a candidate or an eligible contractor to see. It holds
-- nothing from rows 2-6, so reading it pre-confirm is within the matrix.

grant select, insert, delete on public.slots to authenticated;
-- status is granted here: posting or closing an open call is a producer action
-- and the PRD defines no slot state machine. transition_assignment also moves
-- it to 'filled' on confirm.
grant update (role, rate_type, rate_amount_cents, overtime_rule, call_time,
              required_gear, staffing_mode, interest_deadline, is_required, status)
  on public.slots to authenticated;

create policy slots_select_admin_candidate_or_eligible on public.slots
  for select to authenticated
  using (
    app.is_admin(org_id)
    or app.has_assignment_on_slot(id)
    or app.is_eligible_for_slot(id)
  );

create policy slots_insert_manager on public.slots
  for insert to authenticated
  with check (app.can_manage_event(event_id));

create policy slots_update_manager on public.slots
  for update to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

create policy slots_delete_manager on public.slots
  for delete to authenticated
  using (app.can_manage_event(event_id));

-- ================================================================ assignments
-- Entry only: a contractor opts in as 'interested', a producer invites as
-- 'invited'. Every later move goes through transition_assignment, which is why
-- status is absent from the update grant and only 'note' is writable.

grant select, insert on public.assignments to authenticated;
grant update (note) on public.assignments to authenticated;

create policy assignments_select_self_or_admin on public.assignments
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin(org_id));

create policy assignments_insert_opt_in on public.assignments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'interested'
    and app.is_eligible_for_slot(slot_id)
  );

create policy assignments_insert_invite on public.assignments
  for insert to authenticated
  with check (
    status = 'invited'
    and app.can_manage_event(app.slot_event(slot_id))
  );

create policy assignments_update_own_note on public.assignments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ======================================================== shot list (row 4)

grant select, insert, delete on public.shot_list_items to authenticated;
grant update (slot_id, title, description, must_have, reference_image_path, position)
  on public.shot_list_items to authenticated;

create policy shot_list_items_select_admin_or_confirmed on public.shot_list_items
  for select to authenticated
  using (app.is_admin(org_id) or app.packet_visible(event_id));

create policy shot_list_items_insert_manager on public.shot_list_items
  for insert to authenticated
  with check (app.can_manage_event(event_id));

create policy shot_list_items_update_manager on public.shot_list_items
  for update to authenticated
  using (app.can_manage_event(event_id))
  with check (app.can_manage_event(event_id));

create policy shot_list_items_delete_manager on public.shot_list_items
  for delete to authenticated
  using (app.can_manage_event(event_id));

-- The live checklist: the crew member working the slot ticks items off between
-- check-in and check-out (PRD "Event day", steps 5-6).
grant select, insert, delete on public.shot_checks to authenticated;
grant update (outcome, reason, photo_path) on public.shot_checks to authenticated;

create policy shot_checks_select_self_or_admin on public.shot_checks
  for select to authenticated
  using (app.owns_assignment(assignment_id) or app.is_admin(org_id));

create policy shot_checks_insert_own_while_working on public.shot_checks
  for insert to authenticated
  with check (
    app.owns_assignment(assignment_id)
    and exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and a.status = any (array['checked_in', 'checked_out']::public.assignment_status[])
    )
  );

create policy shot_checks_update_own_while_working on public.shot_checks
  for update to authenticated
  using (
    app.owns_assignment(assignment_id)
    and exists (
      select 1
      from public.assignments a
      where a.id = shot_checks.assignment_id
        and a.status = any (array['checked_in', 'checked_out']::public.assignment_status[])
    )
  )
  with check (app.owns_assignment(assignment_id));

create policy shot_checks_delete_own_while_working on public.shot_checks
  for delete to authenticated
  using (
    app.owns_assignment(assignment_id)
    and exists (
      select 1
      from public.assignments a
      where a.id = shot_checks.assignment_id
        and a.status = 'checked_in'
    )
  );

-- ====================================================== deliverables (row 4)

grant select, insert, delete on public.deliverables to authenticated;
grant update (title, spec, due_at) on public.deliverables to authenticated;

create policy deliverables_select_admin_or_confirmed on public.deliverables
  for select to authenticated
  using (app.is_admin(org_id) or app.packet_visible(app.slot_event(slot_id)));

create policy deliverables_insert_manager on public.deliverables
  for insert to authenticated
  with check (app.can_manage_event(app.slot_event(slot_id)));

create policy deliverables_update_manager on public.deliverables
  for update to authenticated
  using (app.can_manage_event(app.slot_event(slot_id)))
  with check (app.can_manage_event(app.slot_event(slot_id)));

create policy deliverables_delete_manager on public.deliverables
  for delete to authenticated
  using (app.can_manage_event(app.slot_event(slot_id)));

-- The contractor must see why changes were requested; the producer writes the
-- review. Reviews are append-only.
grant select, insert on public.deliverable_reviews to authenticated;

create policy deliverable_reviews_select_self_or_admin on public.deliverable_reviews
  for select to authenticated
  using (app.owns_assignment(assignment_id) or app.is_admin(org_id));

create policy deliverable_reviews_insert_manager on public.deliverable_reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and app.can_manage_event(app.assignment_event(assignment_id))
  );

-- =========================================================== footage (row 7)
-- Owner: all. Producer: own events. Contractor: own uploads only — which
-- outlives the 7-day packet window, so this uses owns_assignment rather than
-- packet_visible. Rows are written by the backend after it verifies size and
-- checksum (CLAUDE.md rule 7), so no client write policy exists.

grant select on public.uploads to authenticated;

create policy uploads_select_owner_producer_or_own on public.uploads
  for select to authenticated
  using (
    app.is_owner(org_id)
    or app.can_see_event_money_and_footage(app.assignment_event(assignment_id))
    or app.owns_assignment(assignment_id)
  );

-- ======================================================== connectors (row 11)
-- Organization settings, Stripe and connectors: owner only.

grant select, insert, delete on public.connector_accounts to authenticated;
grant update (root_folder, is_active) on public.connector_accounts to authenticated;

create policy connector_accounts_select_owner on public.connector_accounts
  for select to authenticated
  using (app.is_owner(org_id));

create policy connector_accounts_insert_owner on public.connector_accounts
  for insert to authenticated
  with check (app.is_owner(org_id));

create policy connector_accounts_update_owner on public.connector_accounts
  for update to authenticated
  using (app.is_owner(org_id))
  with check (app.is_owner(org_id));

create policy connector_accounts_delete_owner on public.connector_accounts
  for delete to authenticated
  using (app.is_owner(org_id));

grant select, insert, delete on public.connector_rules to authenticated;
grant update (scope, trigger_on) on public.connector_rules to authenticated;

create policy connector_rules_select_owner on public.connector_rules
  for select to authenticated
  using (app.is_owner(org_id));

create policy connector_rules_insert_owner on public.connector_rules
  for insert to authenticated
  with check (app.is_owner(org_id));

create policy connector_rules_update_owner on public.connector_rules
  for update to authenticated
  using (app.is_owner(org_id))
  with check (app.is_owner(org_id));

create policy connector_rules_delete_owner on public.connector_rules
  for delete to authenticated
  using (app.is_owner(org_id));

-- Sync jobs are queued and retried by the background worker; clients read only.
grant select on public.sync_jobs to authenticated;

create policy sync_jobs_select_owner on public.sync_jobs
  for select to authenticated
  using (app.is_owner(org_id));

-- =========================================================== payouts (row 10)
-- Owner: all. Producer: own events. Contractor: own only. Every move belongs
-- to transition_payout, so there is no client write path at all.

grant select on public.payouts to authenticated;

create policy payouts_select_owner_producer_or_own on public.payouts
  for select to authenticated
  using (
    app.is_owner(org_id)
    or app.can_see_event_money_and_footage(app.assignment_event(assignment_id))
    or app.owns_assignment(assignment_id)
  );

-- =========================================================== ratings (row 9)
-- Owner and producer see all; a contractor never sees ratings, not even
-- their own.

grant select, insert, delete on public.ratings to authenticated;
grant update (quality, punctuality, communication, notes) on public.ratings to authenticated;

create policy ratings_select_admin on public.ratings
  for select to authenticated
  using (app.is_admin(org_id));

create policy ratings_insert_manager on public.ratings
  for insert to authenticated
  with check (
    rater_id = auth.uid()
    and app.can_manage_event(app.assignment_event(assignment_id))
  );

create policy ratings_update_manager on public.ratings
  for update to authenticated
  using (app.can_manage_event(app.assignment_event(assignment_id)))
  with check (app.can_manage_event(app.assignment_event(assignment_id)));

create policy ratings_delete_owner on public.ratings
  for delete to authenticated
  using (app.is_owner(org_id));

-- ============================================== announcements and the inbox
-- Audience targeting (all / by skill / by area / one event's crew) is applied
-- when the fan-out writes notifications. The policy here is the floor: a
-- member of the organization may read an announcement once it is due.

grant select, insert, delete on public.announcements to authenticated;
grant update (audience, body, pinned, scheduled_for) on public.announcements to authenticated;

create policy announcements_select_member on public.announcements
  for select to authenticated
  using (
    app.is_admin(org_id)
    or (app.is_member(org_id) and (scheduled_for is null or scheduled_for <= now()))
  );

create policy announcements_insert_admin on public.announcements
  for insert to authenticated
  with check (app.is_admin(org_id) and author_id = auth.uid());

create policy announcements_update_admin on public.announcements
  for update to authenticated
  using (app.is_admin(org_id))
  with check (app.is_admin(org_id));

create policy announcements_delete_admin on public.announcements
  for delete to authenticated
  using (app.is_admin(org_id));

-- Only the recipient reads their inbox, and the only thing they may write is
-- "I have read this".
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================= activity log
-- Append-only and admin-readable. Rows are written by app.log_activity (and by
-- the backend for contact reads and footage downloads), never by a client.

grant select on public.activity_log to authenticated;

create policy activity_log_select_admin on public.activity_log
  for select to authenticated
  using (app.is_admin(org_id));
