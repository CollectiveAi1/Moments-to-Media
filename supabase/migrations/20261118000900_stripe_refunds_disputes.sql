-- Refunds, disputes and failed bank payments from Stripe.
--
-- Until now a refund or dispute made in Stripe left the invoice saying Paid.
-- A payment now carries how much of it was refunded and how much a dispute is
-- holding, and only what is left counts toward the invoice. Every value is set
-- from Stripe's own totals, never added to, so a replayed or retried webhook
-- changes nothing. Only the service role (the stripe-webhook function) can
-- call these functions; clients and staff still only read payments.

alter table public.client_payments
  add column refunded_cents     integer not null default 0,
  add column disputed_cents     integer not null default 0,
  add column dispute_status     text,
  add column stripe_dispute_id  text,
  add column stripe_dispute_at  timestamptz,
  add constraint client_payments_refund_range check (refunded_cents between 0 and amount_cents),
  add constraint client_payments_dispute_range check (disputed_cents between 0 and amount_cents);

-- What counts toward the invoice: the payment, less refunds, less any amount
-- a dispute is holding. A fully refunded payment is status 'refunded' and
-- counts zero either way.
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
  select coalesce(sum(greatest(p.amount_cents - p.refunded_cents - p.disputed_cents, 0)), 0) into v_paid
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

create or replace function app.notify_owners(p_org uuid, p_type text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (org_id, user_id, type, channels, payload)
  select p_org, m.user_id, p_type, '{in_app}', p_payload
  from public.memberships m
  where m.org_id = p_org and m.status = 'active' and m.role = 'owner';
$$;

-- charge.refunded: p_refunded is the charge's amount_refunded, Stripe's running
-- total. It only ever grows, so an older event arriving late cannot shrink it.
create or replace function public.record_stripe_refund(p_payment_intent text, p_refunded integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay  public.client_payments;
  v_new  integer;
begin
  select * into v_pay from public.client_payments where stripe_payment_intent = p_payment_intent for update;
  if not found then
    -- Stripe retries, which covers a refund event that beats the payment's own.
    raise exception 'no payment for %', p_payment_intent using errcode = 'no_data_found';
  end if;
  v_new := least(greatest(coalesce(p_refunded, 0), v_pay.refunded_cents), v_pay.amount_cents);
  if v_new = v_pay.refunded_cents then
    return v_pay.id;
  end if;

  update public.client_payments
     set refunded_cents = v_new,
         status = case when v_new >= amount_cents then 'refunded'::public.client_payment_status else status end
   where id = v_pay.id;

  perform app.log_activity(v_pay.org_id, 'invoice', v_pay.invoice_id, 'payment_refunded',
    jsonb_build_object('payment_id', v_pay.id, 'refunded_cents', v_new, 'amount_cents', v_pay.amount_cents));
  perform app.notify_owners(v_pay.org_id, 'client_payment_refunded',
    jsonb_build_object('invoice_id', v_pay.invoice_id, 'refunded_cents', v_new));
  return v_pay.id;
end;
$$;

-- charge.dispute.*: while a dispute is open or lost, its amount does not count
-- as paid; when it is won the money is back and it counts again. Events can
-- arrive out of order, so one older than the last applied is ignored.
create or replace function public.record_stripe_dispute(
  p_payment_intent text,
  p_dispute        text,
  p_amount         integer,
  p_status         text,
  p_event_at       timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay  public.client_payments;
  v_held integer;
begin
  select * into v_pay from public.client_payments where stripe_payment_intent = p_payment_intent for update;
  if not found then
    raise exception 'no payment for %', p_payment_intent using errcode = 'no_data_found';
  end if;
  if v_pay.stripe_dispute_at is not null and p_event_at < v_pay.stripe_dispute_at then
    return v_pay.id;
  end if;

  v_held := case
    when p_status in ('won', 'warning_closed', 'prevented') then 0
    else least(greatest(coalesce(p_amount, 0), 0), v_pay.amount_cents)
  end;

  update public.client_payments
     set disputed_cents = v_held,
         dispute_status = p_status,
         stripe_dispute_id = p_dispute,
         stripe_dispute_at = p_event_at
   where id = v_pay.id;

  if v_pay.dispute_status is distinct from p_status then
    perform app.log_activity(v_pay.org_id, 'invoice', v_pay.invoice_id, 'payment_disputed',
      jsonb_build_object('payment_id', v_pay.id, 'dispute', p_dispute, 'status', p_status, 'held_cents', v_held));
    perform app.notify_owners(v_pay.org_id, 'client_payment_disputed',
      jsonb_build_object('invoice_id', v_pay.invoice_id, 'status', p_status, 'held_cents', v_held));
  end if;
  return v_pay.id;
end;
$$;

-- checkout.session.async_payment_failed: a bank payment that did not go
-- through. Nothing was recorded as paid, so this only tells the owners, once.
create or replace function public.record_stripe_payment_failed(p_invoice uuid, p_session text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then
    raise exception 'invoice % not found', p_invoice using errcode = 'no_data_found';
  end if;
  if exists (
    select 1 from public.activity_log
    where entity_type = 'invoice' and entity_id = p_invoice
      and action = 'payment_failed' and change ->> 'stripe_session' = p_session
  ) then
    return;
  end if;
  perform app.log_activity(v_inv.org_id, 'invoice', p_invoice, 'payment_failed',
    jsonb_build_object('stripe_session', p_session));
  perform app.notify_owners(v_inv.org_id, 'client_payment_failed',
    jsonb_build_object('invoice_id', p_invoice, 'number', v_inv.number));
end;
$$;

revoke all on function app.notify_owners(uuid, text, jsonb) from public;
revoke all on function public.record_stripe_refund(text, integer) from public, anon, authenticated;
revoke all on function public.record_stripe_dispute(text, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_stripe_payment_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.record_stripe_refund(text, integer) to service_role;
grant execute on function public.record_stripe_dispute(text, text, integer, text, timestamptz) to service_role;
grant execute on function public.record_stripe_payment_failed(uuid, text) to service_role;
