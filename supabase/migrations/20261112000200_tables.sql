-- Foundation 2/6 — tables, constraints and indexes.
--
-- PRD "Data model". Conventions enforced here:
--   * every organization-scoped table carries org_id not null, indexed  (CLAUDE.md rule 1)
--   * money is integer cents                                           (CLAUDE.md rule 5)
--   * times are timestamptz (UTC); events.time_zone holds the IANA zone (CLAUDE.md rule 5)
--   * every foreign key has an index                                   (CLAUDE.md rule 10)
--
-- Geography: the PRD says "geo point". This migration uses plain
-- latitude/longitude numerics plus a haversine helper rather than enabling
-- PostGIS, so no extension is added. Revisit if we need real spatial indexes.

-- ---------------------------------------------------------------- utilities

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------ organizations

create table public.organizations (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (length(btrim(name)) > 0),
  slug                     text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  branding                 jsonb not null default '{}'::jsonb,
  stripe_account_id        text,
  -- PRD "Payments → Open items": in-app payments are on for Moments to Media only.
  in_app_payments_enabled  boolean not null default false,
  settings                 jsonb not null default jsonb_build_object(
                             'reminder_hours_before_call', jsonb_build_array(24, 2),
                             'invite_window_hours', 24,
                             'confirm_deadline_hours', 12,
                             'payout_auto_approve_under_cents', 0,
                             'footage_retention_days', 90,
                             'required_compliance_documents', jsonb_build_array()
                           ),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index organizations_slug_key on public.organizations (lower(slug));

create trigger organizations_touch
  before update on public.organizations
  for each row execute function app.touch_updated_at();

-- -------------------------------------------------------------- memberships

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.org_role not null,
  status     public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);

create index memberships_org_id_idx on public.memberships (org_id);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_role_idx on public.memberships (org_id, role) where status = 'active';

create trigger memberships_touch
  before update on public.memberships
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------- people
-- Per-user, not per-organization: one login works across organizations
-- (PRD "Users and roles").

create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  full_name       text not null check (length(btrim(full_name)) > 0),
  phone           text,
  email           text,
  photo_path      text,
  bio             text,
  portfolio_links text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function app.touch_updated_at();

create table public.contractor_details (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  skills                 text[] not null default '{}',
  home_base_label        text,
  home_base_latitude     numeric(9, 6) check (home_base_latitude between -90 and 90),
  home_base_longitude    numeric(9, 6) check (home_base_longitude between -180 and 180),
  travel_radius_miles    integer not null default 25 check (travel_radius_miles between 1 and 1000),
  default_rate_cents     integer check (default_rate_cents >= 0),
  -- Stripe Connect Express. The app never stores bank or tax identifiers
  -- (PRD "Payments"); only the account reference and whether payouts are live.
  stripe_account_id      text,
  stripe_payouts_enabled boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint contractor_details_home_base_complete
    check ((home_base_latitude is null) = (home_base_longitude is null))
);

create trigger contractor_details_touch
  before update on public.contractor_details
  for each row execute function app.touch_updated_at();

create table public.equipment (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   public.equipment_category not null,
  make       text,
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index equipment_user_id_idx on public.equipment (user_id);
create index equipment_user_category_idx on public.equipment (user_id, category);

create trigger equipment_touch
  before update on public.equipment
  for each row execute function app.touch_updated_at();

create table public.availability (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  starts_on       date not null,
  ends_on         date not null,
  is_available    boolean not null default true,
  -- Optional weekly recurrence: ISO weekday numbers, 1 = Monday .. 7 = Sunday.
  recurrence_days smallint[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint availability_range check (ends_on >= starts_on),
  constraint availability_recurrence_days_valid
    check (recurrence_days is null or recurrence_days <@ array[1,2,3,4,5,6,7]::smallint[])
);

create index availability_user_id_idx on public.availability (user_id);
create index availability_user_range_idx on public.availability (user_id, starts_on, ends_on);

create trigger availability_touch
  before update on public.availability
  for each row execute function app.touch_updated_at();

create table public.compliance_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  doc_type    text not null check (length(btrim(doc_type)) > 0),
  status      public.compliance_status not null default 'pending',
  file_path   text,
  expires_on  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index compliance_documents_org_id_idx on public.compliance_documents (org_id);
create index compliance_documents_user_id_idx on public.compliance_documents (user_id);
create index compliance_documents_org_user_idx on public.compliance_documents (org_id, user_id, doc_type);
create index compliance_documents_expiry_idx on public.compliance_documents (expires_on)
  where status = 'approved';

create trigger compliance_documents_touch
  before update on public.compliance_documents
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------ clients

create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_org_id_idx on public.clients (org_id);

create trigger clients_touch
  before update on public.clients
  for each row execute function app.touch_updated_at();

create table public.client_contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  phone      text,
  email      text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_contacts_org_id_idx on public.client_contacts (org_id);
create index client_contacts_client_id_idx on public.client_contacts (client_id);

create trigger client_contacts_touch
  before update on public.client_contacts
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------- events

create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  client_id          uuid references public.clients (id) on delete restrict,
  producer_id        uuid not null references auth.users (id) on delete restrict,
  title              text not null check (length(btrim(title)) > 0),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  -- IANA zone, e.g. 'America/Phoenix' (CLAUDE.md rule 5).
  time_zone          text not null,
  -- Coarse location shown before confirm: "neighborhood, not exact address"
  -- (PRD "Contractor app → Job board"). The exact address below is packet data.
  area_label         text,
  venue_name         text,
  address            text,
  latitude           numeric(9, 6) check (latitude between -90 and 90),
  longitude          numeric(9, 6) check (longitude between -180 and 180),
  check_in_radius_m  integer not null default 200 check (check_in_radius_m between 10 and 5000),
  arrival_notes      text,
  parking_notes      text,
  dress_code         text,
  status             public.event_status not null default 'draft',
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint events_window check (ends_at > starts_at),
  constraint events_geo_complete check ((latitude is null) = (longitude is null)),
  constraint events_time_zone_valid check (time_zone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+)*$')
);

create index events_org_id_idx on public.events (org_id);
create index events_client_id_idx on public.events (client_id);
create index events_producer_id_idx on public.events (producer_id);
create index events_org_status_starts_idx on public.events (org_id, status, starts_at);
create index events_completed_at_idx on public.events (completed_at);

create trigger events_touch
  before update on public.events
  for each row execute function app.touch_updated_at();

create table public.event_contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  kind       public.event_contact_kind not null,
  name       text not null check (length(btrim(name)) > 0),
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index event_contacts_org_id_idx on public.event_contacts (org_id);
create index event_contacts_event_id_idx on public.event_contacts (event_id);

create trigger event_contacts_touch
  before update on public.event_contacts
  for each row execute function app.touch_updated_at();

create table public.briefs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  event_id    uuid not null unique references public.events (id) on delete cascade,
  -- One line a candidate may read before confirming; the matrix allows
  -- "Summary line only" at opted-in/invited (PRD "Permissions and data visibility").
  summary     text,
  body        text,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index briefs_org_id_idx on public.briefs (org_id);

create trigger briefs_touch
  before update on public.briefs
  for each row execute function app.touch_updated_at();

-- -------------------------------------------------------------------- slots

create table public.slots (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  event_id           uuid not null references public.events (id) on delete cascade,
  role               text not null check (length(btrim(role)) > 0),
  rate_type          public.rate_type not null,
  rate_amount_cents  integer not null check (rate_amount_cents >= 0),
  -- e.g. {"after_hours": 8, "multiplier": 1.5} (PRD "Payout").
  overtime_rule      jsonb,
  call_time          timestamptz not null,
  -- Equipment categories the slot requires; matched against the roster's equipment.
  required_gear      text[] not null default '{}',
  staffing_mode      public.staffing_mode not null default 'direct_invite',
  interest_deadline  timestamptz,
  -- "Every required slot has a confirmed contractor" gates event → staffed.
  is_required        boolean not null default true,
  status             public.slot_status not null default 'draft',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index slots_org_id_idx on public.slots (org_id);
create index slots_event_id_idx on public.slots (event_id);
create index slots_open_call_idx on public.slots (org_id, interest_deadline)
  where staffing_mode = 'open_call' and status = 'open_call';

create trigger slots_touch
  before update on public.slots
  for each row execute function app.touch_updated_at();

-- -------------------------------------------------------------- assignments

create table public.assignments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  slot_id             uuid not null references public.slots (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  status              public.assignment_status not null,
  note                text,
  -- Direct invites expire after a window (default 24h); a selection must be
  -- confirmed before its deadline (default 12h) — PRD "Staffing".
  invite_expires_at   timestamptz,
  confirm_deadline    timestamptz,
  checked_in_at       timestamptz,
  check_in_latitude   numeric(9, 6),
  check_in_longitude  numeric(9, 6),
  checked_out_at      timestamptz,
  check_out_latitude  numeric(9, 6),
  check_out_longitude numeric(9, 6),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (slot_id, user_id),
  constraint assignments_check_out_after_check_in
    check (checked_out_at is null or checked_in_at is null or checked_out_at >= checked_in_at)
);

create index assignments_org_id_idx on public.assignments (org_id);
create index assignments_slot_id_idx on public.assignments (slot_id);
create index assignments_user_id_idx on public.assignments (user_id);
create index assignments_user_status_idx on public.assignments (user_id, status);
-- One committed contractor per slot: confirmed and everything downstream of it.
create unique index assignments_one_committed_per_slot
  on public.assignments (slot_id)
  where status in ('confirmed', 'checked_in', 'checked_out', 'uploaded',
                   'changes_requested', 'approved', 'paid');

create trigger assignments_touch
  before update on public.assignments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- shot list

create table public.shot_list_items (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  event_id            uuid not null references public.events (id) on delete cascade,
  slot_id             uuid references public.slots (id) on delete set null,
  title               text not null check (length(btrim(title)) > 0),
  description         text,
  must_have           boolean not null default false,
  reference_image_path text,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index shot_list_items_org_id_idx on public.shot_list_items (org_id);
create index shot_list_items_event_id_idx on public.shot_list_items (event_id, position);
create index shot_list_items_slot_id_idx on public.shot_list_items (slot_id);

create trigger shot_list_items_touch
  before update on public.shot_list_items
  for each row execute function app.touch_updated_at();

create table public.shot_checks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  shot_list_item_id  uuid not null references public.shot_list_items (id) on delete cascade,
  assignment_id      uuid not null references public.assignments (id) on delete cascade,
  outcome            public.shot_check_outcome not null,
  reason             text,
  photo_path         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (shot_list_item_id, assignment_id),
  -- "not possible" requires a reason (PRD "Event day", step 6).
  constraint shot_checks_reason_required
    check (outcome <> 'not_possible' or length(btrim(coalesce(reason, ''))) > 0)
);

create index shot_checks_org_id_idx on public.shot_checks (org_id);
create index shot_checks_shot_list_item_id_idx on public.shot_checks (shot_list_item_id);
create index shot_checks_assignment_id_idx on public.shot_checks (assignment_id);

create trigger shot_checks_touch
  before update on public.shot_checks
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------- deliverables

create table public.deliverables (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  slot_id    uuid not null references public.slots (id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  -- {"format": "JPEG", "resolution": "6000x4000", "frame_rate": null, "count": 40}
  spec       jsonb not null default '{}'::jsonb,
  due_at     timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deliverables_org_id_idx on public.deliverables (org_id);
create index deliverables_slot_id_idx on public.deliverables (slot_id);

create trigger deliverables_touch
  before update on public.deliverables
  for each row execute function app.touch_updated_at();

create table public.deliverable_reviews (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  decision       public.review_decision not null,
  notes          text,
  reviewer_id    uuid not null references auth.users (id) on delete restrict,
  -- clock_timestamp(), not now(): app.deliverable_is_approved reads the most
  -- recent review, and several reviews can land in one transaction.
  created_at     timestamptz not null default clock_timestamp(),
  constraint deliverable_reviews_notes_on_changes
    check (decision <> 'changes_requested' or length(btrim(coalesce(notes, ''))) > 0)
);

create index deliverable_reviews_org_id_idx on public.deliverable_reviews (org_id);
create index deliverable_reviews_deliverable_id_idx on public.deliverable_reviews (deliverable_id);
create index deliverable_reviews_assignment_id_idx on public.deliverable_reviews (assignment_id);
create index deliverable_reviews_reviewer_id_idx on public.deliverable_reviews (reviewer_id);

-- ------------------------------------------------------------------ uploads
-- Footage never passes through our servers (CLAUDE.md rule 7): rows here are
-- written by the backend when it presigns parts and when it completes the
-- multipart upload after verifying size and checksum.

create table public.uploads (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  assignment_id       uuid not null references public.assignments (id) on delete cascade,
  kind                public.upload_kind not null default 'raw',
  storage_key         text not null unique,
  filename            text not null,
  bytes               bigint check (bytes >= 0),
  checksum            text,
  multipart_upload_id text,
  status              public.upload_status not null default 'pending',
  preview_key         text,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uploads_completed_has_checksum
    check (status <> 'completed' or (checksum is not null and bytes is not null))
);

create index uploads_org_id_idx on public.uploads (org_id);
create index uploads_assignment_id_idx on public.uploads (assignment_id);
create index uploads_status_idx on public.uploads (org_id, status);

create trigger uploads_touch
  before update on public.uploads
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------- connectors

create table public.connector_accounts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  provider         public.connector_provider not null,
  -- Ciphertext only; the key lives in Edge Function secrets (CLAUDE.md rule 4).
  encrypted_token  text,
  root_folder      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, provider)
);

create index connector_accounts_org_id_idx on public.connector_accounts (org_id);

create trigger connector_accounts_touch
  before update on public.connector_accounts
  for each row execute function app.touch_updated_at();

create table public.connector_rules (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  connector_account_id   uuid not null references public.connector_accounts (id) on delete cascade,
  scope                  public.connector_scope not null default 'both',
  trigger_on             public.connector_trigger not null default 'on_upload_complete',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index connector_rules_org_id_idx on public.connector_rules (org_id);
create index connector_rules_connector_account_id_idx on public.connector_rules (connector_account_id);

create trigger connector_rules_touch
  before update on public.connector_rules
  for each row execute function app.touch_updated_at();

create table public.sync_jobs (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  upload_id            uuid not null references public.uploads (id) on delete cascade,
  connector_account_id uuid not null references public.connector_accounts (id) on delete cascade,
  status               public.sync_status not null default 'queued',
  attempts             integer not null default 0 check (attempts >= 0),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index sync_jobs_org_id_idx on public.sync_jobs (org_id);
create index sync_jobs_upload_id_idx on public.sync_jobs (upload_id);
create index sync_jobs_connector_account_id_idx on public.sync_jobs (connector_account_id);
create index sync_jobs_queue_idx on public.sync_jobs (status, created_at);

create trigger sync_jobs_touch
  before update on public.sync_jobs
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------ payouts

create table public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  assignment_id      uuid not null unique references public.assignments (id) on delete restrict,
  amount_cents       integer not null check (amount_cents >= 0),
  -- [{"label": "Overtime 1.5h", "amount_cents": 7500, "reason": "..."}]
  adjustments        jsonb not null default '[]'::jsonb,
  status             public.payout_status not null default 'draft',
  stripe_transfer_id text unique,
  approved_by        uuid references auth.users (id) on delete set null,
  submitted_at       timestamptz,
  approved_at        timestamptz,
  sent_at            timestamptz,
  paid_at            timestamptz,
  failure_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index payouts_org_id_idx on public.payouts (org_id);
create index payouts_approved_by_idx on public.payouts (approved_by);
create index payouts_org_status_idx on public.payouts (org_id, status);

create trigger payouts_touch
  before update on public.payouts
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------ ratings

create table public.ratings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid not null unique references public.assignments (id) on delete cascade,
  quality       smallint not null check (quality between 1 and 5),
  punctuality   smallint not null check (punctuality between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  notes         text,
  rater_id      uuid not null references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ratings_org_id_idx on public.ratings (org_id);
create index ratings_rater_id_idx on public.ratings (rater_id);

create trigger ratings_touch
  before update on public.ratings
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------- announcements and inbox

create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  author_id     uuid not null references auth.users (id) on delete restrict,
  -- {"kind": "all" | "skill" | "area" | "event_crew", "skill": "...", "event_id": "..."}
  audience      jsonb not null default '{"kind": "all"}'::jsonb,
  body          text not null check (length(btrim(body)) > 0),
  pinned        boolean not null default false,
  scheduled_for timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index announcements_org_id_idx on public.announcements (org_id);
create index announcements_author_id_idx on public.announcements (author_id);
create index announcements_org_schedule_idx on public.announcements (org_id, scheduled_for);

create trigger announcements_touch
  before update on public.announcements
  for each row execute function app.touch_updated_at();

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null check (length(btrim(type)) > 0),
  channels   text[] not null default '{push}',
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_org_id_idx on public.notifications (org_id);
create index notifications_user_id_idx on public.notifications (user_id);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc)
  where read_at is null;

create trigger notifications_touch
  before update on public.notifications
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------- activity log
-- Append-only. Written by the transition functions and by the backend when it
-- serves client contact details or presigns a footage download
-- (PRD "Permissions and data visibility").

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  change      jsonb not null default '{}'::jsonb,
  -- clock_timestamp(), not now(): one transition writes several rows, and the
  -- audit trail has to order them as they happened.
  created_at  timestamptz not null default clock_timestamp()
);

create index activity_log_org_id_idx on public.activity_log (org_id, created_at desc);
create index activity_log_actor_id_idx on public.activity_log (actor_id);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id);

-- -------------------------------------------------- cross-tenant integrity
-- RLS decides who may read or write a row. It does not stop a writer with
-- legitimate access to org A from pointing a new row at a parent in org B,
-- which would put a row carrying org_id = A inside B's event. Composite keys
-- make that unrepresentable: each child's (parent_id, org_id) pair must exist
-- on the parent. The single-column foreign keys above still carry the
-- delete behaviour; these add the tenant half of the reference.

alter table public.organizations add constraint organizations_id_key unique (id);
alter table public.clients add constraint clients_id_org_key unique (id, org_id);
alter table public.events add constraint events_id_org_key unique (id, org_id);
alter table public.slots add constraint slots_id_org_key unique (id, org_id);
alter table public.assignments add constraint assignments_id_org_key unique (id, org_id);
alter table public.shot_list_items add constraint shot_list_items_id_org_key unique (id, org_id);
alter table public.deliverables add constraint deliverables_id_org_key unique (id, org_id);
alter table public.uploads add constraint uploads_id_org_key unique (id, org_id);
alter table public.connector_accounts add constraint connector_accounts_id_org_key unique (id, org_id);

alter table public.client_contacts
  add constraint client_contacts_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade;

alter table public.events
  add constraint events_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete restrict;

alter table public.event_contacts
  add constraint event_contacts_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.briefs
  add constraint briefs_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.slots
  add constraint slots_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.assignments
  add constraint assignments_slot_same_org_fkey
  foreign key (slot_id, org_id) references public.slots (id, org_id) on delete cascade;

alter table public.shot_list_items
  add constraint shot_list_items_event_same_org_fkey
  foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.shot_list_items
  add constraint shot_list_items_slot_same_org_fkey
  foreign key (slot_id, org_id) references public.slots (id, org_id) on delete set null (slot_id);

alter table public.shot_checks
  add constraint shot_checks_item_same_org_fkey
  foreign key (shot_list_item_id, org_id) references public.shot_list_items (id, org_id) on delete cascade;

alter table public.shot_checks
  add constraint shot_checks_assignment_same_org_fkey
  foreign key (assignment_id, org_id) references public.assignments (id, org_id) on delete cascade;

alter table public.deliverables
  add constraint deliverables_slot_same_org_fkey
  foreign key (slot_id, org_id) references public.slots (id, org_id) on delete cascade;

alter table public.deliverable_reviews
  add constraint deliverable_reviews_deliverable_same_org_fkey
  foreign key (deliverable_id, org_id) references public.deliverables (id, org_id) on delete cascade;

alter table public.deliverable_reviews
  add constraint deliverable_reviews_assignment_same_org_fkey
  foreign key (assignment_id, org_id) references public.assignments (id, org_id) on delete cascade;

alter table public.uploads
  add constraint uploads_assignment_same_org_fkey
  foreign key (assignment_id, org_id) references public.assignments (id, org_id) on delete cascade;

alter table public.connector_rules
  add constraint connector_rules_account_same_org_fkey
  foreign key (connector_account_id, org_id) references public.connector_accounts (id, org_id) on delete cascade;

alter table public.sync_jobs
  add constraint sync_jobs_upload_same_org_fkey
  foreign key (upload_id, org_id) references public.uploads (id, org_id) on delete cascade;

alter table public.sync_jobs
  add constraint sync_jobs_account_same_org_fkey
  foreign key (connector_account_id, org_id) references public.connector_accounts (id, org_id) on delete cascade;

alter table public.payouts
  add constraint payouts_assignment_same_org_fkey
  foreign key (assignment_id, org_id) references public.assignments (id, org_id) on delete restrict;

alter table public.ratings
  add constraint ratings_assignment_same_org_fkey
  foreign key (assignment_id, org_id) references public.assignments (id, org_id) on delete cascade;
