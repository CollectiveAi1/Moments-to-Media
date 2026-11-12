-- Foundation 1/6 — enumerated types and the private helper schema.
--
-- PRD "Data model", "Status lifecycles". Status values are the database's
-- source of truth; packages/shared/src/status.ts mirrors them for the clients.

create schema if not exists app;
comment on schema app is
  'Private helpers (access predicates, transition internals). Not exposed through the API — see config.toml [api] schemas.';

-- Roles a person can hold inside one organization (PRD "Users and roles").
create type public.org_role as enum ('owner', 'producer', 'contractor', 'client');

create type public.membership_status as enum ('invited', 'active', 'suspended');

-- PRD "Status lifecycles → Event".
create type public.event_status as enum (
  'draft',
  'staffing',
  'staffed',
  'in_progress',
  'uploaded',
  'complete',
  'cancelled'
);

-- PRD "Status lifecycles → Contractor on a slot": 9 states plus the exits.
create type public.assignment_status as enum (
  'invited',
  'interested',
  'selected',
  'confirmed',
  'checked_in',
  'checked_out',
  'uploaded',
  'changes_requested',
  'approved',
  'paid',
  'declined',
  'not_selected',
  'withdrawn',
  'expired',
  'cancelled',
  'dropped'
);

-- PRD "Payments → Payout states".
create type public.payout_status as enum (
  'draft',
  'submitted',
  'approved',
  'sent',
  'paid',
  'failed',
  'reversed'
);

create type public.slot_status as enum ('draft', 'inviting', 'open_call', 'filled', 'cancelled');

create type public.staffing_mode as enum ('direct_invite', 'open_call');

create type public.rate_type as enum ('flat', 'hourly', 'day');

-- PRD "Data model → equipment".
create type public.equipment_category as enum (
  'camera_body',
  'lens',
  'audio',
  'lighting',
  'drone',
  'other'
);

create type public.compliance_status as enum ('pending', 'submitted', 'approved', 'rejected', 'expired');

create type public.event_contact_kind as enum ('on_site', 'emergency');

create type public.shot_check_outcome as enum ('captured', 'not_possible');

create type public.review_decision as enum ('approved', 'changes_requested');

-- PRD "Footage pipeline → Folder structure": raw | selects | deliverables.
create type public.upload_kind as enum ('raw', 'selects', 'deliverables');

create type public.upload_status as enum ('pending', 'in_progress', 'completed', 'failed', 'aborted');

create type public.connector_provider as enum ('google_drive', 'dropbox', 'frameio');

-- PRD "Footage pipeline → Connectors": what to copy, and when.
create type public.connector_scope as enum ('raw', 'approved_deliverables', 'both');
create type public.connector_trigger as enum ('on_upload_complete', 'on_approval');

create type public.sync_status as enum ('queued', 'running', 'succeeded', 'failed');
