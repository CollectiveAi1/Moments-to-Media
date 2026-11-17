-- The client side: packages, inquiries, proposals with e-signature, invoices
-- with installments, client payments, messages, and media released to the
-- client. See docs/honeybook-comparison.md for why, and docs/PRD.md "Users and
-- roles" for the Client role this finally gives screens to.
--
-- Same rules as the crew side (CLAUDE.md):
--   * every table has org_id, an index on it, RLS and explicit policies;
--   * status columns are not in any update grant: proposals, invoices, leads
--     and payments change state only through the functions at the bottom;
--   * money is integer cents.
--
-- Who is a client: a person with an active 'client' membership in the org whose
-- user id is on one of that client's contacts (client_contacts.user_id). They
-- get there by accepting a portal invitation (org_invitations.client_id).
--
-- Two things work without signing in, both through security-definer functions
-- that anon may call and nothing else: submitting the public inquiry form, and
-- opening, signing or declining a proposal from its secret link. anon still
-- reads no table directly.

-- ===================================================================== enums

create type public.lead_status as enum ('new', 'contacted', 'proposal_sent', 'booked', 'lost');
create type public.proposal_status as enum ('draft', 'sent', 'viewed', 'accepted', 'declined', 'void');
create type public.invoice_status as enum ('draft', 'open', 'partially_paid', 'paid', 'void');
create type public.client_payment_method as enum ('card', 'ach', 'check', 'cash', 'bank_transfer', 'other');
create type public.client_payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');

-- ============================================================ organizations

-- Off until Moments to Media connects its own Stripe account and the owner
-- switches card payments on. Until then the owner records payments by hand.
alter table public.organizations
  add column client_payments_enabled boolean not null default false;

grant update (client_payments_enabled) on public.organizations to authenticated;

-- ============================================================ client logins

alter table public.client_contacts
  add column user_id uuid references auth.users (id) on delete set null;

create index client_contacts_user_id_idx on public.client_contacts (user_id);
create unique index client_contacts_one_login_per_client
  on public.client_contacts (client_id, user_id) where user_id is not null;

alter table public.org_invitations
  add column client_id uuid references public.clients (id) on delete cascade;

create index org_invitations_client_id_idx on public.org_invitations (client_id);

alter table public.org_invitations
  add constraint org_invitations_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade;

alter table public.org_invitations
  add constraint org_invitations_client_role check ((role = 'client') = (client_id is not null));

-- ------------------------------------------------------------ helpers

create or replace function app.is_client_of(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_client is not null and exists (
    select 1
    from public.client_contacts c
    join public.memberships m
      on m.org_id = c.org_id and m.user_id = c.user_id
     and m.role = 'client' and m.status = 'active'
    where c.client_id = p_client
      and c.user_id = auth.uid()
  );
$$;

comment on function app.is_client_of(uuid) is
  'True when the caller signs in as a contact of this client and holds an active client membership in its organization.';

create or replace function app.client_owns_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event and app.is_client_of(e.client_id)
  );
$$;

-- When a client invitation is claimed, attach the new login to the contact
-- with that email, or add the person as a contact if the producer invited an
-- address that is not on file yet.
create or replace function app.link_client_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_name  text;
  v_found integer;
begin
  if new.role <> 'client' or new.client_id is null or new.accepted_by is null then
    return new;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = new.accepted_by;

  update public.client_contacts c
     set user_id = new.accepted_by
   where c.client_id = new.client_id
     and c.user_id is null
     and lower(c.email) = coalesce(v_email, lower(new.email));
  get diagnostics v_found = row_count;

  if v_found = 0 and not exists (
    select 1 from public.client_contacts c
    where c.client_id = new.client_id and c.user_id = new.accepted_by
  ) then
    select p.full_name into v_name from public.profiles p where p.user_id = new.accepted_by;
    insert into public.client_contacts (org_id, client_id, name, email, user_id)
    values (new.org_id, new.client_id,
            coalesce(nullif(btrim(v_name), ''), split_part(coalesce(v_email, new.email), '@', 1)),
            coalesce(v_email, new.email), new.accepted_by);
  end if;

  return new;
end;
$$;

create trigger org_invitations_link_client_login
  after update of status on public.org_invitations
  for each row
  when (new.status = 'accepted' and old.status <> 'accepted')
  execute function app.link_client_login();

-- ================================================================= packages

create table public.packages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  description text,
  price_cents integer not null check (price_cents >= 0),
  is_addon    boolean not null default false,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index packages_org_id_idx on public.packages (org_id);
alter table public.packages add constraint packages_id_org_key unique (id, org_id);

create trigger packages_touch
  before update on public.packages
  for each row execute function app.touch_updated_at();

-- ==================================================================== leads

create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  email       text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text,
  event_type  text,
  event_date  date,
  location    text,
  package_id  uuid references public.packages (id) on delete set null,
  message     text check (message is null or length(message) <= 5000),
  source      text not null default 'inquiry_form',
  status      public.lead_status not null default 'new',
  client_id   uuid references public.clients (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint leads_reachable check (email is not null or nullif(btrim(coalesce(phone, '')), '') is not null)
);

create index leads_org_id_idx on public.leads (org_id, created_at desc);
create index leads_package_id_idx on public.leads (package_id);
create index leads_client_id_idx on public.leads (client_id);
alter table public.leads add constraint leads_id_org_key unique (id, org_id);

create trigger leads_touch
  before update on public.leads
  for each row execute function app.touch_updated_at();

-- ================================================================ proposals

create table public.proposals (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations (id) on delete cascade,
  lead_id                  uuid references public.leads (id) on delete set null,
  client_id                uuid references public.clients (id) on delete restrict,
  created_by               uuid not null references auth.users (id) on delete restrict,
  -- The secret in the link the client opens. Long and random; never listed to
  -- anyone but the organization's admins.
  token                    text not null unique
                             default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  title                    text not null check (length(btrim(title)) > 0),
  client_name              text not null check (length(btrim(client_name)) > 0),
  client_email             text not null check (client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  intro                    text,
  contract_body            text not null default '',
  event_starts_at          timestamptz not null,
  event_ends_at            timestamptz not null,
  time_zone                text not null default 'America/New_York',
  venue_name               text,
  address                  text,
  tax_rate_bp              integer not null default 0 check (tax_rate_bp between 0 and 3000),
  discount_cents           integer not null default 0 check (discount_cents >= 0),
  deposit_percent          integer not null default 30 check (deposit_percent between 0 and 100),
  balance_due_days_before  integer not null default 7 check (balance_due_days_before between 0 and 365),
  expires_on               date,
  status                   public.proposal_status not null default 'draft',
  sent_at                  timestamptz,
  viewed_at                timestamptz,
  responded_at             timestamptz,
  signer_name              text,
  signature                text,
  signed_contract          text,
  decline_reason           text,
  event_id                 uuid references public.events (id) on delete set null,
  invoice_id               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint proposals_window check (event_ends_at > event_starts_at),
  constraint proposals_signed check ((status = 'accepted') = (signature is not null)),
  constraint proposals_time_zone_valid check (time_zone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+)*$')
);

create index proposals_org_id_idx on public.proposals (org_id, created_at desc);
create index proposals_lead_id_idx on public.proposals (lead_id);
create index proposals_client_id_idx on public.proposals (client_id);
create index proposals_created_by_idx on public.proposals (created_by);
create index proposals_event_id_idx on public.proposals (event_id);
create index proposals_invoice_id_idx on public.proposals (invoice_id);
alter table public.proposals add constraint proposals_id_org_key unique (id, org_id);

create trigger proposals_touch
  before update on public.proposals
  for each row execute function app.touch_updated_at();

create table public.proposal_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  proposal_id  uuid not null references public.proposals (id) on delete cascade,
  package_id   uuid references public.packages (id) on delete set null,
  name         text not null check (length(btrim(name)) > 0),
  description  text,
  price_cents  integer not null check (price_cents >= 0),
  quantity     integer not null default 1 check (quantity between 1 and 1000),
  optional     boolean not null default false,
  selected     boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index proposal_items_org_id_idx on public.proposal_items (org_id);
create index proposal_items_proposal_id_idx on public.proposal_items (proposal_id);
create index proposal_items_package_id_idx on public.proposal_items (package_id);

alter table public.proposal_items
  add constraint proposal_items_proposal_same_org_fkey
  foreign key (proposal_id, org_id) references public.proposals (id, org_id) on delete cascade;

create trigger proposal_items_touch
  before update on public.proposal_items
  for each row execute function app.touch_updated_at();

-- Once a proposal leaves draft, what the client was offered is fixed: a
-- changed price after sending would change what they sign.
create or replace function app.proposal_items_draft_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.proposal_status;
begin
  if current_setting('app.proposal_accepting', true) = 'on' then
    return coalesce(new, old);
  end if;
  select p.status into v_status from public.proposals p
  where p.id = coalesce(new.proposal_id, old.proposal_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'this proposal has been sent; void it and send a new one to change what it offers'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger proposal_items_draft_only
  before insert or update or delete on public.proposal_items
  for each row execute function app.proposal_items_draft_only();

create or replace function app.proposal_fields_draft_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.proposal_transition', true) = 'on' then
    return new;
  end if;
  if old.status <> 'draft' then
    raise exception 'this proposal has been sent; void it and send a new one to change it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger proposals_draft_only
  before update on public.proposals
  for each row execute function app.proposal_fields_draft_only();

-- ================================================================= invoices

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete restrict,
  event_id        uuid references public.events (id) on delete set null,
  proposal_id     uuid references public.proposals (id) on delete set null,
  created_by      uuid not null references auth.users (id) on delete restrict,
  number          integer not null default 0,
  title           text not null check (length(btrim(title)) > 0),
  notes           text,
  tax_rate_bp     integer not null default 0 check (tax_rate_bp between 0 and 3000),
  discount_cents  integer not null default 0 check (discount_cents >= 0),
  subtotal_cents  integer not null default 0,
  tax_cents       integer not null default 0,
  total_cents     integer not null default 0,
  paid_cents      integer not null default 0,
  status          public.invoice_status not null default 'draft',
  sent_at         timestamptz,
  paid_at         timestamptz,
  voided_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint invoices_number_per_org unique (org_id, number)
);

create index invoices_org_id_idx on public.invoices (org_id, created_at desc);
create index invoices_client_id_idx on public.invoices (client_id);
create index invoices_event_id_idx on public.invoices (event_id);
create index invoices_proposal_id_idx on public.invoices (proposal_id);
create index invoices_created_by_idx on public.invoices (created_by);
alter table public.invoices add constraint invoices_id_org_key unique (id, org_id);

alter table public.invoices
  add constraint invoices_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete restrict;

alter table public.proposals
  add constraint proposals_invoice_id_fkey
  foreign key (invoice_id) references public.invoices (id) on delete set null;

create trigger invoices_touch
  before update on public.invoices
  for each row execute function app.touch_updated_at();

create or replace function app.next_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('invoice_number:' || new.org_id::text));
  select coalesce(max(i.number), 1000) + 1 into new.number
  from public.invoices i where i.org_id = new.org_id;
  return new;
end;
$$;

create trigger invoices_number
  before insert on public.invoices
  for each row execute function app.next_invoice_number();

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  description text not null check (length(btrim(description)) > 0),
  quantity    integer not null default 1 check (quantity between 1 and 1000),
  unit_cents  integer not null check (unit_cents >= 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index invoice_lines_org_id_idx on public.invoice_lines (org_id);
create index invoice_lines_invoice_id_idx on public.invoice_lines (invoice_id);

alter table public.invoice_lines
  add constraint invoice_lines_invoice_same_org_fkey
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade;

create trigger invoice_lines_touch
  before update on public.invoice_lines
  for each row execute function app.touch_updated_at();

-- A payment schedule: deposit now, balance before the event, or any split.
-- Which installments are paid is worked out from invoices.paid_cents, oldest
-- due first, so a payment never has to be matched to an installment by hand.
create table public.invoice_installments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  label        text not null check (length(btrim(label)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  due_on       date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index invoice_installments_org_id_idx on public.invoice_installments (org_id);
create index invoice_installments_invoice_id_idx on public.invoice_installments (invoice_id, due_on);

alter table public.invoice_installments
  add constraint invoice_installments_invoice_same_org_fkey
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade;

create trigger invoice_installments_touch
  before update on public.invoice_installments
  for each row execute function app.touch_updated_at();

create or replace function app.invoice_lines_draft_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
begin
  if current_setting('app.invoice_building', true) = 'on' then
    return coalesce(new, old);
  end if;
  select i.status into v_status from public.invoices i
  where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'this invoice has been sent; void it and issue a new one to change it'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_lines_draft_only
  before insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_draft_only();

create trigger invoice_installments_draft_only
  before insert or update or delete on public.invoice_installments
  for each row execute function app.invoice_lines_draft_only();

-- Totals are always computed here, never written by a client.
create or replace function app.recompute_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub  bigint;
  v_inv  public.invoices;
  v_base bigint;
  v_tax  bigint;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then
    return;
  end if;
  select coalesce(sum(l.quantity::bigint * l.unit_cents), 0) into v_sub
  from public.invoice_lines l where l.invoice_id = p_invoice;
  v_base := greatest(v_sub - v_inv.discount_cents, 0);
  v_tax := round(v_base * v_inv.tax_rate_bp / 10000.0);

  perform set_config('app.invoice_totals', 'on', true);
  update public.invoices
     set subtotal_cents = v_sub,
         tax_cents = v_tax,
         total_cents = v_base + v_tax
   where id = p_invoice;
  perform set_config('app.invoice_totals', 'off', true);
end;
$$;

create or replace function app.invoice_lines_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recompute_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;

create trigger invoice_lines_recompute
  after insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_recompute();

create or replace function app.invoice_rates_recompute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.invoice_totals', true) = 'on' then
    return null;
  end if;
  if new.tax_rate_bp is distinct from old.tax_rate_bp
     or new.discount_cents is distinct from old.discount_cents then
    perform app.recompute_invoice(new.id);
  end if;
  return null;
end;
$$;

create trigger invoices_rates_recompute
  after update of tax_rate_bp, discount_cents on public.invoices
  for each row execute function app.invoice_rates_recompute();

create or replace function app.invoice_fields_draft_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.invoice_totals', true) = 'on'
     or current_setting('app.invoice_transition', true) = 'on' then
    return new;
  end if;
  if old.status <> 'draft' and (
       new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.discount_cents is distinct from old.discount_cents
    or new.title is distinct from old.title
    or new.client_id is distinct from old.client_id) then
    raise exception 'this invoice has been sent; void it and issue a new one to change it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger invoices_draft_only
  before update on public.invoices
  for each row execute function app.invoice_fields_draft_only();

-- ========================================================== client payments

create table public.client_payments (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  invoice_id           uuid not null references public.invoices (id) on delete restrict,
  amount_cents         integer not null check (amount_cents > 0),
  method               public.client_payment_method not null,
  status               public.client_payment_status not null default 'succeeded',
  reference            text,
  -- Set for card payments. Unique, so a replayed Stripe webhook records nothing twice.
  stripe_session_id    text unique,
  stripe_payment_intent text unique,
  received_at          timestamptz not null default now(),
  recorded_by          uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now()
);

create index client_payments_org_id_idx on public.client_payments (org_id, received_at desc);
create index client_payments_invoice_id_idx on public.client_payments (invoice_id);
create index client_payments_recorded_by_idx on public.client_payments (recorded_by);

alter table public.client_payments
  add constraint client_payments_invoice_same_org_fkey
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete restrict;

-- Paid amount and status follow the payments. This is the only path that moves
-- an invoice between open, partially_paid and paid.
create or replace function app.apply_client_payments(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid bigint;
  v_inv  public.invoices;
  v_next public.invoice_status;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then
    return;
  end if;
  select coalesce(sum(p.amount_cents), 0) into v_paid
  from public.client_payments p
  where p.invoice_id = p_invoice and p.status = 'succeeded';

  v_next := case
    when v_inv.status in ('draft', 'void') then v_inv.status
    when v_paid >= v_inv.total_cents and v_inv.total_cents > 0 then 'paid'
    when v_paid > 0 then 'partially_paid'
    else 'open'
  end;

  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices
     set paid_cents = v_paid,
         status = v_next,
         paid_at = case when v_next = 'paid' then coalesce(paid_at, now()) else null end
   where id = p_invoice;
  perform set_config('app.invoice_transition', 'off', true);

  if v_next is distinct from v_inv.status then
    perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'status_changed',
      jsonb_build_object('from', v_inv.status, 'to', v_next, 'paid_cents', v_paid));
  end if;
end;
$$;

create or replace function app.client_payments_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.apply_client_payments(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;

create trigger client_payments_apply
  after insert or update or delete on public.client_payments
  for each row execute function app.client_payments_apply();

-- ================================================================= messages

create table public.client_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete restrict,
  from_client boolean not null,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now()
);

create index client_messages_org_id_idx on public.client_messages (org_id);
create index client_messages_client_id_idx on public.client_messages (client_id, created_at);
create index client_messages_author_id_idx on public.client_messages (author_id);

alter table public.client_messages
  add constraint client_messages_client_same_org_fkey
  foreign key (client_id, org_id) references public.clients (id, org_id) on delete cascade;

-- ============================================================ media release

-- The producer releases an event's approved media to the client. Only
-- completed uploads on approved or paid assignments are ever shown.
create table public.media_releases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  event_id    uuid not null unique references public.events (id) on delete cascade,
  released_by uuid not null references auth.users (id) on delete restrict,
  message     text,
  released_at timestamptz not null default now()
);

create index media_releases_org_id_idx on public.media_releases (org_id);
create index media_releases_released_by_idx on public.media_releases (released_by);

create or replace function app.client_can_download(p_upload uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.uploads u
    join public.assignments a on a.id = u.assignment_id
    join public.slots s on s.id = a.slot_id
    join public.media_releases r on r.event_id = s.event_id
    where u.id = p_upload
      and u.status = 'completed'
      and a.status in ('approved', 'paid')
      and app.client_owns_event(s.event_id)
  );
$$;

-- ======================================================================= RLS

alter table public.packages             enable row level security;
alter table public.leads                enable row level security;
alter table public.proposals            enable row level security;
alter table public.proposal_items       enable row level security;
alter table public.invoices             enable row level security;
alter table public.invoice_lines        enable row level security;
alter table public.invoice_installments enable row level security;
alter table public.client_payments      enable row level security;
alter table public.client_messages      enable row level security;
alter table public.media_releases       enable row level security;

revoke all on public.packages, public.leads, public.proposals, public.proposal_items,
  public.invoices, public.invoice_lines, public.invoice_installments,
  public.client_payments, public.client_messages, public.media_releases
  from anon, authenticated;

-- packages: admins manage; clients may see the active catalog.
grant select, insert, delete on public.packages to authenticated;
grant update (name, description, price_cents, is_addon, active, sort_order) on public.packages to authenticated;
create policy packages_select on public.packages for select to authenticated
  using (app.is_admin(org_id) or (active and app.has_role(org_id, '{client}')));
create policy packages_insert_admin on public.packages for insert to authenticated
  with check (app.is_admin(org_id));
create policy packages_update_admin on public.packages for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy packages_delete_admin on public.packages for delete to authenticated
  using (app.is_admin(org_id));

-- leads: admins only. The public form writes through submit_inquiry().
grant select, insert, delete on public.leads to authenticated;
grant update (name, email, phone, event_type, event_date, location, package_id, message, client_id)
  on public.leads to authenticated;
create policy leads_select_admin on public.leads for select to authenticated using (app.is_admin(org_id));
create policy leads_insert_admin on public.leads for insert to authenticated
  with check (app.is_admin(org_id) and status = 'new');
create policy leads_update_admin on public.leads for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy leads_delete_owner on public.leads for delete to authenticated using (app.is_owner(org_id));

-- proposals: admins write drafts; the client sees theirs once sent.
grant select, insert, delete on public.proposals to authenticated;
grant update (lead_id, client_id, title, client_name, client_email, intro, contract_body,
  event_starts_at, event_ends_at, time_zone, venue_name, address, tax_rate_bp, discount_cents,
  deposit_percent, balance_due_days_before, expires_on)
  on public.proposals to authenticated;
create policy proposals_select on public.proposals for select to authenticated
  using (app.is_admin(org_id) or (status <> 'draft' and app.is_client_of(client_id)));
create policy proposals_insert_admin on public.proposals for insert to authenticated
  with check (app.is_admin(org_id) and status = 'draft' and created_by = auth.uid());
create policy proposals_update_admin on public.proposals for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy proposals_delete_admin on public.proposals for delete to authenticated
  using (app.is_admin(org_id) and status = 'draft');

grant select, insert, delete on public.proposal_items to authenticated;
grant update (package_id, name, description, price_cents, quantity, optional, selected, sort_order)
  on public.proposal_items to authenticated;
create policy proposal_items_select on public.proposal_items for select to authenticated
  using (app.is_admin(org_id) or exists (
    select 1 from public.proposals p
    where p.id = proposal_id and p.status <> 'draft' and app.is_client_of(p.client_id)));
create policy proposal_items_insert_admin on public.proposal_items for insert to authenticated
  with check (app.is_admin(org_id));
create policy proposal_items_update_admin on public.proposal_items for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy proposal_items_delete_admin on public.proposal_items for delete to authenticated
  using (app.is_admin(org_id));

-- invoices and their parts: admins write drafts; the client sees theirs once sent.
create or replace function app.client_sees_invoice(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = p_invoice and i.status <> 'draft' and app.is_client_of(i.client_id)
  );
$$;

grant select, insert, delete on public.invoices to authenticated;
grant update (title, notes, tax_rate_bp, discount_cents, event_id) on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (app.is_admin(org_id) or (status <> 'draft' and app.is_client_of(client_id)));
create policy invoices_insert_admin on public.invoices for insert to authenticated
  with check (app.is_admin(org_id) and status = 'draft' and created_by = auth.uid());
create policy invoices_update_admin on public.invoices for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy invoices_delete_admin on public.invoices for delete to authenticated
  using (app.is_admin(org_id) and status = 'draft');

grant select, insert, delete on public.invoice_lines to authenticated;
grant update (description, quantity, unit_cents, sort_order) on public.invoice_lines to authenticated;
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (app.is_admin(org_id) or app.client_sees_invoice(invoice_id));
create policy invoice_lines_insert_admin on public.invoice_lines for insert to authenticated
  with check (app.is_admin(org_id));
create policy invoice_lines_update_admin on public.invoice_lines for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy invoice_lines_delete_admin on public.invoice_lines for delete to authenticated
  using (app.is_admin(org_id));

grant select, insert, delete on public.invoice_installments to authenticated;
grant update (label, amount_cents, due_on) on public.invoice_installments to authenticated;
create policy invoice_installments_select on public.invoice_installments for select to authenticated
  using (app.is_admin(org_id) or app.client_sees_invoice(invoice_id));
create policy invoice_installments_insert_admin on public.invoice_installments for insert to authenticated
  with check (app.is_admin(org_id));
create policy invoice_installments_update_admin on public.invoice_installments for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy invoice_installments_delete_admin on public.invoice_installments for delete to authenticated
  using (app.is_admin(org_id));

-- client payments: read-only to everyone; written by record_client_payment()
-- (owner or producer, by hand) and record_stripe_payment() (the webhook).
grant select on public.client_payments to authenticated;
create policy client_payments_select on public.client_payments for select to authenticated
  using (app.is_admin(org_id) or app.client_sees_invoice(invoice_id));

-- messages: admins and the client's own logins, each writing as themselves.
grant select, insert on public.client_messages to authenticated;
create policy client_messages_select on public.client_messages for select to authenticated
  using (app.is_admin(org_id) or app.is_client_of(client_id));
create policy client_messages_insert on public.client_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and ((from_client and app.is_client_of(client_id))
      or (not from_client and app.is_admin(org_id)))
  );

-- media releases: written by release_media(); visible to admins and the client.
grant select on public.media_releases to authenticated;
create policy media_releases_select on public.media_releases for select to authenticated
  using (app.is_admin(org_id) or app.client_owns_event(event_id));

-- the client's view of existing tables
create policy clients_select_client on public.clients for select to authenticated
  using (app.is_client_of(id));
create policy client_contacts_select_client on public.client_contacts for select to authenticated
  using (app.is_client_of(client_id));
create policy events_select_client on public.events for select to authenticated
  using (app.is_client_of(client_id));
create policy uploads_select_client on public.uploads for select to authenticated
  using (app.client_can_download(id));


-- ============================================================== functions

-- ---------------------------------------------------- public inquiry form

create or replace function public.inquiry_form(p_org_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  select * into v_org from public.organizations where slug = lower(btrim(p_org_slug));
  if not found then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'org_name', v_org.name,
    'branding', v_org.branding,
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
                                          'price_cents', p.price_cents, 'is_addon', p.is_addon)
                       order by p.is_addon, p.sort_order, p.price_cents)
      from public.packages p where p.org_id = v_org.id and p.active), '[]'::jsonb));
end;
$$;

create or replace function public.submit_inquiry(
  p_org_slug   text,
  p_name       text,
  p_email      text,
  p_phone      text,
  p_event_type text,
  p_event_date date,
  p_location   text,
  p_package    uuid,
  p_message    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_id    uuid;
begin
  select id into v_org from public.organizations where slug = lower(btrim(p_org_slug));
  if v_org is null then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'tell us your name' using errcode = 'check_violation';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'leave an email or a phone number so we can reply' using errcode = 'check_violation';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that email address does not look right' using errcode = 'check_violation';
  end if;
  if p_event_date is not null and p_event_date < current_date then
    raise exception 'the event date is in the past' using errcode = 'check_violation';
  end if;

  -- Abuse limits for an open form: five a day from one address, two hundred
  -- an hour into one organization.
  if v_email is not null and (
    select count(*) from public.leads l
    where l.org_id = v_org and lower(l.email) = v_email and l.created_at > now() - interval '1 day') >= 5 then
    raise exception 'we already have your inquiry; we will be in touch' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.leads l
      where l.org_id = v_org and l.created_at > now() - interval '1 hour') >= 200 then
    raise exception 'too many inquiries right now; try again later' using errcode = 'check_violation';
  end if;

  if p_package is not null and not exists (
    select 1 from public.packages p where p.id = p_package and p.org_id = v_org and p.active) then
    p_package := null;
  end if;

  insert into public.leads (org_id, name, email, phone, event_type, event_date, location, package_id, message)
  values (v_org, btrim(p_name), v_email, v_phone,
          nullif(btrim(coalesce(p_event_type, '')), ''), p_event_date,
          nullif(btrim(coalesce(p_location, '')), ''), p_package,
          left(nullif(btrim(coalesce(p_message, '')), ''), 5000))
  returning id into v_id;

  insert into public.notifications (org_id, user_id, type, channels, payload)
  select v_org, m.user_id, 'new_inquiry', '{in_app}',
         jsonb_build_object('lead_id', v_id, 'name', btrim(p_name), 'event_date', p_event_date)
  from public.memberships m
  where m.org_id = v_org and m.status = 'active' and m.role in ('owner', 'producer');

  perform app.log_activity(v_org, 'lead', v_id, 'inquiry_received', '{}'::jsonb);
  return v_id;
end;
$$;

-- ------------------------------------------------------------ leads

create or replace function public.set_lead_status(p_lead uuid, p_status public.lead_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = p_lead for update;
  if not found or not app.is_admin(v_lead.org_id) then
    raise exception 'only the organization''s admins can update a lead' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'booked' then
    raise exception 'a lead is booked when the client accepts a proposal' using errcode = 'check_violation';
  end if;
  if v_lead.status = 'booked' then
    raise exception 'this lead is booked; manage it from the client' using errcode = 'check_violation';
  end if;
  if v_lead.status = p_status then
    return;
  end if;
  update public.leads set status = p_status where id = p_lead;
  perform app.log_activity(v_lead.org_id, 'lead', p_lead, 'status_changed',
    jsonb_build_object('from', v_lead.status, 'to', p_status));
end;
$$;

-- -------------------------------------------------------- proposals

create or replace function app.proposal_totals(p_proposal uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.proposals where id = p_proposal),
  s as (
    select coalesce(sum(i.quantity::bigint * i.price_cents) filter (where i.selected or not i.optional), 0) as sub
    from public.proposal_items i where i.proposal_id = p_proposal
  ),
  t as (
    select s.sub, greatest(s.sub - p.discount_cents, 0) as base, p.tax_rate_bp, p.deposit_percent
    from s, p
  )
  select jsonb_build_object(
    'subtotal_cents', t.sub,
    'discount_cents', t.sub - t.base,
    'tax_cents', round(t.base * t.tax_rate_bp / 10000.0),
    'total_cents', t.base + round(t.base * t.tax_rate_bp / 10000.0),
    'deposit_cents', round((t.base + round(t.base * t.tax_rate_bp / 10000.0)) * t.deposit_percent / 100.0))
  from t;
$$;

create or replace function public.send_proposal(p_proposal uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.proposals;
begin
  select * into v_p from public.proposals where id = p_proposal for update;
  if not found or not app.is_admin(v_p.org_id) then
    raise exception 'only the organization''s admins can send a proposal' using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'draft' then
    raise exception 'this proposal was already sent' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.proposal_items i where i.proposal_id = p_proposal and not i.optional) then
    raise exception 'add at least one package that is not optional' using errcode = 'check_violation';
  end if;
  if length(btrim(v_p.contract_body)) < 20 then
    raise exception 'write the contract the client will sign' using errcode = 'check_violation';
  end if;
  if v_p.event_starts_at < now() then
    raise exception 'the event date is in the past' using errcode = 'check_violation';
  end if;

  perform set_config('app.proposal_transition', 'on', true);
  update public.proposals set status = 'sent', sent_at = now() where id = p_proposal;
  perform set_config('app.proposal_transition', 'off', true);

  if v_p.lead_id is not null then
    update public.leads set status = 'proposal_sent'
    where id = v_p.lead_id and status in ('new', 'contacted');
  end if;

  perform app.log_activity(v_p.org_id, 'proposal', p_proposal, 'sent', '{}'::jsonb);
  return v_p.token;
end;
$$;

create or replace function public.void_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.proposals;
begin
  select * into v_p from public.proposals where id = p_proposal for update;
  if not found or not app.is_admin(v_p.org_id) then
    raise exception 'only the organization''s admins can void a proposal' using errcode = 'insufficient_privilege';
  end if;
  if v_p.status not in ('sent', 'viewed') then
    raise exception 'only a proposal waiting on the client can be voided (this one is %)', v_p.status
      using errcode = 'check_violation';
  end if;
  perform set_config('app.proposal_transition', 'on', true);
  update public.proposals set status = 'void', responded_at = now() where id = p_proposal;
  perform set_config('app.proposal_transition', 'off', true);
  perform app.log_activity(v_p.org_id, 'proposal', p_proposal, 'voided', '{}'::jsonb);
end;
$$;

-- What the client sees at /p/<token>. Opening it the first time marks it viewed.
create or replace function public.open_proposal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p   public.proposals;
  v_org public.organizations;
begin
  select * into v_p from public.proposals where token = p_token and length(p_token) >= 48;
  if not found or v_p.status = 'draft' then
    raise exception 'this proposal link is not valid' using errcode = 'no_data_found';
  end if;
  select * into v_org from public.organizations where id = v_p.org_id;

  if v_p.status = 'sent' then
    perform set_config('app.proposal_transition', 'on', true);
    update public.proposals set status = 'viewed', viewed_at = now() where id = v_p.id;
    perform set_config('app.proposal_transition', 'off', true);
    perform app.log_activity(v_p.org_id, 'proposal', v_p.id, 'viewed', '{}'::jsonb);
    v_p.status := 'viewed';
  end if;

  return jsonb_build_object(
    'org_name', v_org.name,
    'title', v_p.title,
    'client_name', v_p.client_name,
    'intro', v_p.intro,
    'contract_body', case when v_p.status = 'accepted' then v_p.signed_contract else v_p.contract_body end,
    'event_starts_at', v_p.event_starts_at,
    'event_ends_at', v_p.event_ends_at,
    'time_zone', v_p.time_zone,
    'venue_name', v_p.venue_name,
    'address', v_p.address,
    'status', v_p.status,
    'expired', v_p.expires_on is not null and v_p.expires_on < current_date and v_p.status in ('sent', 'viewed'),
    'deposit_percent', v_p.deposit_percent,
    'balance_due_days_before', v_p.balance_due_days_before,
    'tax_rate_bp', v_p.tax_rate_bp,
    'discount_cents', v_p.discount_cents,
    'signer_name', v_p.signer_name,
    'responded_at', v_p.responded_at,
    'totals', app.proposal_totals(v_p.id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'description', i.description,
                                          'price_cents', i.price_cents, 'quantity', i.quantity,
                                          'optional', i.optional, 'selected', i.selected)
                       order by i.optional, i.sort_order, i.created_at)
      from public.proposal_items i where i.proposal_id = v_p.id), '[]'::jsonb));
end;
$$;

-- The client signs. One transaction: chosen add-ons are fixed, the contract is
-- snapshotted with the signature, and the job is created: the client record,
-- a Draft event for staffing, an invoice with a deposit and a balance, and a
-- portal invitation for the signer's email.
create or replace function public.accept_proposal(
  p_token      text,
  p_signer     text,
  p_signature  text,
  p_addons     uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.proposals;
  v_lead     public.leads;
  v_client   uuid;
  v_event    uuid;
  v_invoice  uuid;
  v_totals   jsonb;
  v_total    bigint;
  v_deposit  bigint;
  v_due      date;
  v_today    date;
begin
  select * into v_p from public.proposals where token = p_token and length(p_token) >= 48 for update;
  if not found or v_p.status = 'draft' then
    raise exception 'this proposal link is not valid' using errcode = 'no_data_found';
  end if;
  if v_p.status not in ('sent', 'viewed') then
    raise exception 'this proposal is %; it cannot be signed', v_p.status using errcode = 'check_violation';
  end if;
  if v_p.expires_on is not null and v_p.expires_on < current_date then
    raise exception 'this proposal expired on %; ask for a new one', v_p.expires_on using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_signer, '')), '') is null or length(btrim(coalesce(p_signature, ''))) < 2 then
    raise exception 'type your full name to sign' using errcode = 'check_violation';
  end if;
  if lower(btrim(p_signature)) <> lower(btrim(p_signer)) then
    raise exception 'the signature must match the name you entered' using errcode = 'check_violation';
  end if;

  perform set_config('app.proposal_accepting', 'on', true);
  update public.proposal_items i
     set selected = (not i.optional) or i.id = any (coalesce(p_addons, '{}'))
   where i.proposal_id = v_p.id;
  perform set_config('app.proposal_accepting', 'off', true);

  v_totals := app.proposal_totals(v_p.id);
  v_total := (v_totals ->> 'total_cents')::bigint;
  v_deposit := (v_totals ->> 'deposit_cents')::bigint;

  -- the client record
  v_client := v_p.client_id;
  if v_client is null then
    if v_p.lead_id is not null then
      select * into v_lead from public.leads where id = v_p.lead_id;
      v_client := v_lead.client_id;
    end if;
    if v_client is null then
      insert into public.clients (org_id, name) values (v_p.org_id, btrim(v_p.client_name))
      returning id into v_client;
      insert into public.client_contacts (org_id, client_id, name, email, phone, is_primary)
      values (v_p.org_id, v_client, btrim(p_signer), lower(v_p.client_email), v_lead.phone, true);
    end if;
  end if;

  -- the job, in Draft, ready to staff
  insert into public.events (org_id, client_id, producer_id, title, starts_at, ends_at, time_zone,
                             venue_name, address, area_label)
  values (v_p.org_id, v_client, v_p.created_by, v_p.title, v_p.event_starts_at, v_p.event_ends_at,
          v_p.time_zone, v_p.venue_name, v_p.address, v_lead.location)
  returning id into v_event;

  -- the invoice, built from what was signed
  perform set_config('app.invoice_building', 'on', true);
  insert into public.invoices (org_id, client_id, event_id, proposal_id, created_by, title,
                               tax_rate_bp, discount_cents, number)
  values (v_p.org_id, v_client, v_event, v_p.id, v_p.created_by, v_p.title,
          v_p.tax_rate_bp, v_p.discount_cents, 0)
  returning id into v_invoice;

  insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_cents, sort_order)
  select v_p.org_id, v_invoice, i.name, i.quantity, i.price_cents,
         row_number() over (order by i.optional, i.sort_order, i.created_at)
  from public.proposal_items i
  where i.proposal_id = v_p.id and i.selected;

  v_today := (now() at time zone v_p.time_zone)::date;
  v_due := greatest(((v_p.event_starts_at at time zone v_p.time_zone)::date - v_p.balance_due_days_before), v_today);
  if v_total > 0 then
    if v_deposit > 0 and v_deposit < v_total then
      insert into public.invoice_installments (org_id, invoice_id, label, amount_cents, due_on)
      values (v_p.org_id, v_invoice, 'Deposit to book', v_deposit, v_today),
             (v_p.org_id, v_invoice, 'Balance', v_total - v_deposit, v_due);
    elsif v_deposit >= v_total then
      insert into public.invoice_installments (org_id, invoice_id, label, amount_cents, due_on)
      values (v_p.org_id, v_invoice, 'Paid in full to book', v_total, v_today);
    else
      insert into public.invoice_installments (org_id, invoice_id, label, amount_cents, due_on)
      values (v_p.org_id, v_invoice, 'Balance', v_total, v_due);
    end if;
  end if;

  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices
     set status = case when v_total > 0 then 'open'::public.invoice_status else 'paid'::public.invoice_status end,
         sent_at = now(),
         paid_at = case when v_total > 0 then null else now() end
   where id = v_invoice;
  perform set_config('app.invoice_transition', 'off', true);
  perform set_config('app.invoice_building', 'off', true);

  -- the proposal itself
  perform set_config('app.proposal_transition', 'on', true);
  update public.proposals
     set status = 'accepted',
         responded_at = now(),
         signer_name = btrim(p_signer),
         signature = btrim(p_signature),
         signed_contract = contract_body
           || E'\n\n— Signed electronically by ' || btrim(p_signature)
           || ' on ' || to_char(now() at time zone time_zone, 'FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ' (' || time_zone || ')',
         client_id = v_client,
         event_id = v_event,
         invoice_id = v_invoice
   where id = v_p.id;
  perform set_config('app.proposal_transition', 'off', true);

  if v_p.lead_id is not null then
    update public.leads set status = 'booked', client_id = v_client where id = v_p.lead_id;
  end if;

  -- a portal login for the signer, unless they have one for this client already
  if not exists (
    select 1 from public.client_contacts c
    where c.client_id = v_client and lower(c.email) = lower(v_p.client_email) and c.user_id is not null
  ) and not exists (
    select 1 from public.org_invitations i
    where i.org_id = v_p.org_id and i.status = 'pending' and i.email = lower(v_p.client_email)
  ) then
    insert into public.org_invitations (org_id, role, email, invited_by, client_id, expires_at)
    values (v_p.org_id, 'client', lower(v_p.client_email), v_p.created_by, v_client, now() + interval '90 days');
  end if;

  insert into public.notifications (org_id, user_id, type, channels, payload)
  values (v_p.org_id, v_p.created_by, 'proposal_accepted', '{in_app}',
          jsonb_build_object('proposal_id', v_p.id, 'event_id', v_event, 'invoice_id', v_invoice,
                             'client_name', v_p.client_name, 'total_cents', v_total));

  perform app.log_activity(v_p.org_id, 'proposal', v_p.id, 'accepted',
    jsonb_build_object('signer', btrim(p_signer), 'total_cents', v_total, 'event_id', v_event, 'invoice_id', v_invoice));

  return jsonb_build_object('event_id', v_event, 'invoice_id', v_invoice, 'client_id', v_client,
                            'total_cents', v_total, 'deposit_cents', least(v_deposit, v_total),
                            'portal_email', lower(v_p.client_email));
end;
$$;

create or replace function public.decline_proposal(p_token text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.proposals;
begin
  select * into v_p from public.proposals where token = p_token and length(p_token) >= 48 for update;
  if not found or v_p.status = 'draft' then
    raise exception 'this proposal link is not valid' using errcode = 'no_data_found';
  end if;
  if v_p.status not in ('sent', 'viewed') then
    raise exception 'this proposal is % already', v_p.status using errcode = 'check_violation';
  end if;
  perform set_config('app.proposal_transition', 'on', true);
  update public.proposals
     set status = 'declined', responded_at = now(), decline_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 2000)
   where id = v_p.id;
  perform set_config('app.proposal_transition', 'off', true);
  insert into public.notifications (org_id, user_id, type, channels, payload)
  values (v_p.org_id, v_p.created_by, 'proposal_declined', '{in_app}',
          jsonb_build_object('proposal_id', v_p.id, 'client_name', v_p.client_name));
  perform app.log_activity(v_p.org_id, 'proposal', v_p.id, 'declined', '{}'::jsonb);
end;
$$;

-- --------------------------------------------------------- invoices

create or replace function public.send_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   public.invoices;
  v_sched bigint;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found or not app.is_admin(v_inv.org_id) then
    raise exception 'only the organization''s admins can send an invoice' using errcode = 'insufficient_privilege';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'this invoice was already sent' using errcode = 'check_violation';
  end if;
  if v_inv.total_cents <= 0 then
    raise exception 'add at least one line with a price' using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount_cents), 0) into v_sched from public.invoice_installments where invoice_id = p_invoice;
  if v_sched = 0 then
    perform set_config('app.invoice_building', 'on', true);
    insert into public.invoice_installments (org_id, invoice_id, label, amount_cents, due_on)
    values (v_inv.org_id, p_invoice, 'Due on receipt', v_inv.total_cents, current_date);
    perform set_config('app.invoice_building', 'off', true);
  elsif v_sched <> v_inv.total_cents then
    raise exception 'the payment schedule adds up to % but the invoice total is %; fix the schedule',
      v_sched, v_inv.total_cents using errcode = 'check_violation';
  end if;

  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set status = 'open', sent_at = now() where id = p_invoice;
  perform set_config('app.invoice_transition', 'off', true);
  perform app.apply_client_payments(p_invoice);
  perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'sent', '{}'::jsonb);
end;
$$;

create or replace function public.void_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found or not app.is_owner(v_inv.org_id) then
    raise exception 'only an owner can void an invoice' using errcode = 'insufficient_privilege';
  end if;
  if v_inv.status in ('void', 'draft') then
    raise exception 'this invoice is %; delete a draft instead', v_inv.status using errcode = 'check_violation';
  end if;
  if v_inv.paid_cents > 0 then
    raise exception 'money has been received on this invoice; refund it before voiding' using errcode = 'check_violation';
  end if;
  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set status = 'void', voided_at = now() where id = p_invoice;
  perform set_config('app.invoice_transition', 'off', true);
  perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'voided', '{}'::jsonb);
end;
$$;

-- Checks, cash, Zelle and the like, recorded by hand.
create or replace function public.record_client_payment(
  p_invoice   uuid,
  p_amount    integer,
  p_method    public.client_payment_method,
  p_reference text,
  p_received  date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_id  uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found or not app.is_admin(v_inv.org_id) then
    raise exception 'only the organization''s admins can record a payment' using errcode = 'insufficient_privilege';
  end if;
  if v_inv.status not in ('open', 'partially_paid') then
    raise exception 'this invoice is %; payments go on an open invoice', v_inv.status using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'enter the amount received' using errcode = 'check_violation';
  end if;
  if p_amount > v_inv.total_cents - v_inv.paid_cents then
    raise exception 'that is more than the % still owed', v_inv.total_cents - v_inv.paid_cents
      using errcode = 'check_violation';
  end if;
  if p_method = 'card' then
    raise exception 'card payments are recorded by Stripe' using errcode = 'check_violation';
  end if;

  insert into public.client_payments (org_id, invoice_id, amount_cents, method, reference, received_at, recorded_by)
  values (v_inv.org_id, p_invoice, p_amount, p_method, nullif(btrim(coalesce(p_reference, '')), ''),
          coalesce(p_received::timestamptz, now()), auth.uid())
  returning id into v_id;

  perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'payment_recorded',
    jsonb_build_object('amount_cents', p_amount, 'method', p_method));
  return v_id;
end;
$$;

-- Called by the stripe-webhook Edge Function only. Idempotent: the session id
-- is unique, so a replayed event returns the payment already recorded.
create or replace function public.record_stripe_payment(
  p_invoice        uuid,
  p_amount         integer,
  p_session        text,
  p_payment_intent text,
  p_method         public.client_payment_method
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_id  uuid;
begin
  select id into v_id from public.client_payments where stripe_session_id = p_session;
  if v_id is not null then
    return v_id;
  end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'invoice % not found', p_invoice using errcode = 'no_data_found';
  end if;
  insert into public.client_payments (org_id, invoice_id, amount_cents, method, reference,
                                      stripe_session_id, stripe_payment_intent)
  values (v_inv.org_id, p_invoice, p_amount, coalesce(p_method, 'card'), 'Stripe', p_session, p_payment_intent)
  returning id into v_id;

  insert into public.notifications (org_id, user_id, type, channels, payload)
  select v_inv.org_id, m.user_id, 'client_payment', '{in_app}',
         jsonb_build_object('invoice_id', p_invoice, 'number', v_inv.number, 'amount_cents', p_amount)
  from public.memberships m
  where m.org_id = v_inv.org_id and m.status = 'active' and m.role = 'owner';

  perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'payment_received',
    jsonb_build_object('amount_cents', p_amount, 'method', 'card', 'stripe_session', p_session));
  return v_id;
end;
$$;

-- ---------------------------------------------------- media and portal

create or replace function public.release_media(p_event uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  if not found or not app.can_manage_event(p_event) then
    raise exception 'only this event''s producer or an owner can release media' using errcode = 'insufficient_privilege';
  end if;
  if v_event.client_id is null then
    raise exception 'set the event''s client before releasing media' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.uploads u
    join public.assignments a on a.id = u.assignment_id
    join public.slots s on s.id = a.slot_id
    where s.event_id = p_event and u.status = 'completed' and a.status in ('approved', 'paid')) then
    raise exception 'approve at least one contractor''s footage first' using errcode = 'check_violation';
  end if;

  insert into public.media_releases (org_id, event_id, released_by, message)
  values (v_event.org_id, p_event, auth.uid(), nullif(btrim(coalesce(p_message, '')), ''))
  on conflict (event_id) do update set message = excluded.message, released_at = now(), released_by = excluded.released_by;

  insert into public.notifications (org_id, user_id, type, channels, payload)
  select v_event.org_id, c.user_id, 'media_ready', '{in_app}',
         jsonb_build_object('event_id', p_event, 'event_title', v_event.title)
  from public.client_contacts c
  where c.client_id = v_event.client_id and c.user_id is not null;

  perform app.log_activity(v_event.org_id, 'event', p_event, 'media_released', '{}'::jsonb);
end;
$$;

create or replace function public.invite_client_login(p_client uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_email  text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_id     uuid;
begin
  select * into v_client from public.clients where id = p_client;
  if not found or not app.is_admin(v_client.org_id) then
    raise exception 'only the organization''s admins can invite a client' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter the client''s email address' using errcode = 'check_violation';
  end if;
  select id into v_id from public.org_invitations
  where org_id = v_client.org_id and status = 'pending' and email = v_email;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.org_invitations (org_id, role, email, invited_by, client_id, expires_at)
  values (v_client.org_id, 'client', v_email, auth.uid(), p_client, now() + interval '90 days')
  returning id into v_id;
  perform app.log_activity(v_client.org_id, 'client', p_client, 'portal_invited', jsonb_build_object('email', v_email));
  return v_id;
end;
$$;

-- --------------------------------------------------------------- grants

revoke all on function
  public.inquiry_form(text),
  public.submit_inquiry(text, text, text, text, text, date, text, uuid, text),
  public.set_lead_status(uuid, public.lead_status),
  public.send_proposal(uuid),
  public.void_proposal(uuid),
  public.open_proposal(text),
  public.accept_proposal(text, text, text, uuid[]),
  public.decline_proposal(text, text),
  public.send_invoice(uuid),
  public.void_invoice(uuid),
  public.record_client_payment(uuid, integer, public.client_payment_method, text, date),
  public.record_stripe_payment(uuid, integer, text, text, public.client_payment_method),
  public.release_media(uuid, text),
  public.invite_client_login(uuid, text)
  from public, anon, authenticated;

-- The only things anon can do: read a public form, send an inquiry, and act on
-- a proposal it holds the secret link for.
grant execute on function
  public.inquiry_form(text),
  public.submit_inquiry(text, text, text, text, text, date, text, uuid, text),
  public.open_proposal(text),
  public.accept_proposal(text, text, text, uuid[]),
  public.decline_proposal(text, text)
  to anon, authenticated;

grant execute on function
  public.set_lead_status(uuid, public.lead_status),
  public.send_proposal(uuid),
  public.void_proposal(uuid),
  public.send_invoice(uuid),
  public.void_invoice(uuid),
  public.record_client_payment(uuid, integer, public.client_payment_method, text, date),
  public.release_media(uuid, text),
  public.invite_client_login(uuid, text)
  to authenticated;

grant execute on function public.record_stripe_payment(uuid, integer, text, text, public.client_payment_method)
  to service_role;

revoke all on function
  app.is_client_of(uuid), app.client_owns_event(uuid), app.client_can_download(uuid),
  app.client_sees_invoice(uuid), app.proposal_totals(uuid), app.recompute_invoice(uuid),
  app.apply_client_payments(uuid)
  from public;
grant execute on function
  app.is_client_of(uuid), app.client_owns_event(uuid), app.client_can_download(uuid),
  app.client_sees_invoice(uuid)
  to authenticated, service_role;
