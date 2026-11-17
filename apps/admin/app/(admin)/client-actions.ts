'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { cents, fail, failWith, int, text } from '@/lib/errors';
import { zonedToUtc } from '@/lib/format';
import { settle, succeed } from '@/lib/mutate';
import { sendSignInLink } from '@/lib/supabase/mailer';

/**
 * Server actions for the client side of the console: packages, inquiries,
 * proposals, invoices, client records and messages. Each runs as the signed-in
 * admin; row-level security and the functions in
 * supabase/migrations/20261118000100_client_side.sql decide what is allowed.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function id(form: FormData, name: string): string | null {
  const v = text(form, name);
  return v && UUID.test(v) ? v : null;
}

// ------------------------------------------------------------------ packages

export async function savePackage(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const name = text(form, 'name');
  const price = cents(form, 'price');
  if (!name) return fail('Name the package.');
  if (price === null) return fail('Enter a price in dollars, for example 1500.');
  const row = {
    name,
    description: text(form, 'description'),
    price_cents: price,
    is_addon: form.get('is_addon') === 'on',
    active: form.get('inactive') !== 'on',
    sort_order: int(form, 'sort_order') ?? 0,
  };
  const packageId = id(form, 'package_id');
  const { error } = packageId
    ? await viewer.supabase.from('packages').update(row).eq('id', packageId)
    : await viewer.supabase.from('packages').insert({ ...row, org_id: viewer.org.id });
  return settle(error, packageId ? `${name} saved.` : `${name} added to your packages.`);
}

export async function deletePackage(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const packageId = id(form, 'package_id');
  if (!packageId) return fail('That package was not found.');
  const { error } = await viewer.supabase.from('packages').delete().eq('id', packageId);
  return settle(error, 'Package removed.');
}

// ------------------------------------------------------------------- leads

export async function addLead(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const name = text(form, 'name');
  const email = text(form, 'email')?.toLowerCase() ?? null;
  const phone = text(form, 'phone');
  if (!name) return fail('Enter the person’s name.');
  if (!email && !phone) return fail('Add an email or a phone number.');
  if (email && !EMAIL.test(email)) return fail('That email address does not look right.');
  const { error } = await viewer.supabase.from('leads').insert({
    org_id: viewer.org.id,
    name,
    email,
    phone,
    event_type: text(form, 'event_type'),
    event_date: text(form, 'event_date'),
    location: text(form, 'location'),
    message: text(form, 'message'),
    source: 'manual',
  });
  return settle(error, `${name} added to inquiries.`);
}

export async function setLeadStatus(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const leadId = id(form, 'lead_id');
  const status = text(form, 'status');
  if (!leadId || !status) return fail('That inquiry was not found.');
  const { error } = await viewer.supabase.rpc('set_lead_status', { p_lead: leadId, p_status: status });
  return settle(error, status === 'lost' ? 'Marked lost.' : status === 'contacted' ? 'Marked contacted.' : 'Inquiry updated.');
}

// --------------------------------------------------------------- proposals

const DEFAULT_CONTRACT = `1. Services. Moments to Media will provide the photo and video coverage described in this proposal on the date and at the location above.

2. Booking and payment. The date is reserved when this proposal is signed and the deposit is paid. The balance is due by the date on the invoice. Late balances may delay delivery.

3. Delivery. Edited media is delivered through your client portal within the time stated in your package, counted from the event date.

4. Cancellation. The deposit is non-refundable. If you cancel more than 30 days before the event, nothing further is owed. Within 30 days, the full amount is owed.

5. Rescheduling. One change of date is free if we are available on the new date.

6. Usage. You may use delivered media for any personal or business purpose. We may use it in our portfolio unless you tell us in writing not to.

7. Limits. If we cannot attend because of illness, emergency or events beyond our control, we will send a qualified replacement or refund every payment in full. Our liability is limited to the amount paid.`;

export async function createProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const title = text(form, 'title');
  const clientName = text(form, 'client_name');
  const clientEmail = text(form, 'client_email')?.toLowerCase() ?? null;
  const date = text(form, 'date');
  const start = text(form, 'start') ?? '17:00';
  const end = text(form, 'end') ?? '22:00';
  const zone = text(form, 'zone') ?? 'America/New_York';
  if (!title) return fail('Give the proposal a title, for example "Smith wedding coverage".');
  if (!clientName) return fail('Enter the client’s name.');
  if (!clientEmail || !EMAIL.test(clientEmail)) return fail('Enter the client’s email. The signed copy and portal access go there.');
  if (!date) return fail('Choose the event date.');
  const startsAt = zonedToUtc(date, start, zone);
  let endsAt = zonedToUtc(date, end, zone);
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);

  const { data, error } = await viewer.supabase
    .from('proposals')
    .insert({
      org_id: viewer.org.id,
      created_by: viewer.userId,
      lead_id: id(form, 'lead_id'),
      client_id: id(form, 'client_id'),
      title,
      client_name: clientName,
      client_email: clientEmail,
      intro: text(form, 'intro'),
      contract_body: DEFAULT_CONTRACT,
      event_starts_at: startsAt.toISOString(),
      event_ends_at: endsAt.toISOString(),
      time_zone: zone,
      venue_name: text(form, 'venue_name'),
      address: text(form, 'address'),
      deposit_percent: int(form, 'deposit_percent') ?? 30,
    })
    .select('id')
    .single();
  if (error || !data) return failWith(error);

  const packageId = id(form, 'package_id');
  if (packageId) {
    const { data: pkg } = await viewer.supabase.from('packages').select('id, name, description, price_cents').eq('id', packageId).maybeSingle();
    if (pkg) {
      await viewer.supabase.from('proposal_items').insert({
        org_id: viewer.org.id,
        proposal_id: data.id,
        package_id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        price_cents: pkg.price_cents,
      });
    }
  }
  await succeed('Draft proposal created. Add packages, check the contract, then send it.');
  redirect(`/proposals/${String(data.id)}`);
}

export async function updateProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const proposalId = id(form, 'proposal_id');
  if (!proposalId) return fail('That proposal was not found.');
  const title = text(form, 'title');
  const clientName = text(form, 'client_name');
  const clientEmail = text(form, 'client_email')?.toLowerCase() ?? null;
  const date = text(form, 'date');
  const zone = text(form, 'zone') ?? 'America/New_York';
  if (!title || !clientName) return fail('Title and client name are required.');
  if (!clientEmail || !EMAIL.test(clientEmail)) return fail('Enter the client’s email.');
  if (!date) return fail('Choose the event date.');
  const startsAt = zonedToUtc(date, text(form, 'start') ?? '17:00', zone);
  let endsAt = zonedToUtc(date, text(form, 'end') ?? '22:00', zone);
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);
  const taxPercent = Number(text(form, 'tax_percent') ?? '0');
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 30) return fail('Tax is a percentage between 0 and 30.');
  const contract = text(form, 'contract_body');
  if (!contract || contract.length < 20) return fail('Write the contract the client will sign.');

  const { error } = await viewer.supabase
    .from('proposals')
    .update({
      title,
      client_name: clientName,
      client_email: clientEmail,
      intro: text(form, 'intro'),
      contract_body: contract,
      event_starts_at: startsAt.toISOString(),
      event_ends_at: endsAt.toISOString(),
      time_zone: zone,
      venue_name: text(form, 'venue_name'),
      address: text(form, 'address'),
      tax_rate_bp: Math.round(taxPercent * 100),
      discount_cents: cents(form, 'discount') ?? 0,
      deposit_percent: int(form, 'deposit_percent') ?? 30,
      balance_due_days_before: int(form, 'balance_due_days_before') ?? 7,
      expires_on: text(form, 'expires_on'),
    })
    .eq('id', proposalId);
  return settle(error, 'Proposal saved.');
}

export async function addProposalItem(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const proposalId = id(form, 'proposal_id');
  if (!proposalId) return fail('That proposal was not found.');
  const packageId = id(form, 'package_id');
  let row: { name: string; description: string | null; price_cents: number; package_id: string | null };
  if (packageId) {
    const { data: pkg } = await viewer.supabase.from('packages').select('id, name, description, price_cents').eq('id', packageId).maybeSingle();
    if (!pkg) return fail('That package was not found.');
    row = { name: String(pkg.name), description: (pkg.description as string | null) ?? null, price_cents: Number(pkg.price_cents), package_id: String(pkg.id) };
  } else {
    const name = text(form, 'name');
    const price = cents(form, 'price');
    if (!name) return fail('Choose a package or name a custom line.');
    if (price === null) return fail('Enter the price in dollars.');
    row = { name, description: text(form, 'description'), price_cents: price, package_id: null };
  }
  const optional = form.get('optional') === 'on';
  const { error } = await viewer.supabase.from('proposal_items').insert({
    ...row,
    org_id: viewer.org.id,
    proposal_id: proposalId,
    quantity: Math.max(1, int(form, 'quantity') ?? 1),
    optional,
    selected: !optional,
  });
  return settle(error, optional ? `${row.name} offered as an optional add-on.` : `${row.name} added.`);
}

export async function removeProposalItem(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const itemId = id(form, 'item_id');
  if (!itemId) return fail('That line was not found.');
  const { error } = await viewer.supabase.from('proposal_items').delete().eq('id', itemId);
  return settle(error, 'Line removed.');
}

export async function sendProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const proposalId = id(form, 'proposal_id');
  if (!proposalId) return fail('That proposal was not found.');
  const { error } = await viewer.supabase.rpc('send_proposal', { p_proposal: proposalId });
  return settle(error, 'Proposal is live. Copy the link below and send it to your client.');
}

export async function voidProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const proposalId = id(form, 'proposal_id');
  if (!proposalId) return fail('That proposal was not found.');
  const { error } = await viewer.supabase.rpc('void_proposal', { p_proposal: proposalId });
  return settle(error, 'Proposal voided. Its link no longer accepts a signature.');
}

export async function deleteProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const proposalId = id(form, 'proposal_id');
  if (!proposalId) return fail('That proposal was not found.');
  const { error } = await viewer.supabase.from('proposals').delete().eq('id', proposalId);
  if (error) return failWith(error);
  await succeed('Draft deleted.');
  redirect('/proposals');
}

// ---------------------------------------------------------------- invoices

export async function createInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const clientId = id(form, 'client_id');
  const title = text(form, 'title');
  if (!clientId) return fail('Choose the client.');
  if (!title) return fail('Give the invoice a title.');
  const { data, error } = await viewer.supabase
    .from('invoices')
    .insert({ org_id: viewer.org.id, client_id: clientId, event_id: id(form, 'event_id'), created_by: viewer.userId, title })
    .select('id')
    .single();
  if (error || !data) return failWith(error);
  await succeed('Draft invoice created. Add lines and a payment schedule, then send it.');
  redirect(`/invoices/${String(data.id)}`);
}

export async function updateInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const taxPercent = Number(text(form, 'tax_percent') ?? '0');
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 30) return fail('Tax is a percentage between 0 and 30.');
  const title = text(form, 'title');
  if (!title) return fail('Give the invoice a title.');
  const { error } = await viewer.supabase
    .from('invoices')
    .update({ title, notes: text(form, 'notes'), tax_rate_bp: Math.round(taxPercent * 100), discount_cents: cents(form, 'discount') ?? 0 })
    .eq('id', invoiceId);
  return settle(error, 'Invoice saved.');
}

export async function updateInvoiceNotes(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const { error } = await viewer.supabase.from('invoices').update({ notes: text(form, 'notes') }).eq('id', invoiceId);
  return settle(error, 'Note saved.');
}

export async function addInvoiceLine(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const packageId = id(form, 'package_id');
  let description = text(form, 'description');
  let unit = cents(form, 'price');
  if (packageId) {
    const { data: pkg } = await viewer.supabase.from('packages').select('name, price_cents').eq('id', packageId).maybeSingle();
    if (!pkg) return fail('That package was not found.');
    description = String(pkg.name);
    unit = Number(pkg.price_cents);
  }
  if (!description) return fail('Describe the line or choose a package.');
  if (unit === null) return fail('Enter the price in dollars.');
  const { error } = await viewer.supabase.from('invoice_lines').insert({
    org_id: viewer.org.id,
    invoice_id: invoiceId,
    description,
    unit_cents: unit,
    quantity: Math.max(1, int(form, 'quantity') ?? 1),
  });
  return settle(error, `${description} added.`);
}

export async function removeInvoiceLine(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const lineId = id(form, 'line_id');
  if (!lineId) return fail('That line was not found.');
  const { error } = await viewer.supabase.from('invoice_lines').delete().eq('id', lineId);
  return settle(error, 'Line removed.');
}

export async function addInstallment(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  const label = text(form, 'label');
  const amount = cents(form, 'amount');
  const dueOn = text(form, 'due_on');
  if (!invoiceId) return fail('That invoice was not found.');
  if (!label) return fail('Label the payment, for example Deposit.');
  if (!amount) return fail('Enter the amount in dollars.');
  if (!dueOn) return fail('Choose the due date.');
  const { error } = await viewer.supabase.from('invoice_installments').insert({ org_id: viewer.org.id, invoice_id: invoiceId, label, amount_cents: amount, due_on: dueOn });
  return settle(error, `${label} added to the schedule.`);
}

export async function splitInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  const pct = int(form, 'deposit_percent');
  const balanceDue = text(form, 'balance_due');
  if (!invoiceId) return fail('That invoice was not found.');
  if (pct === null || pct < 1 || pct > 99) return fail('Deposit is a percentage between 1 and 99.');
  if (!balanceDue) return fail('Choose when the balance is due.');
  const { data: inv } = await viewer.supabase.from('invoices').select('total_cents').eq('id', invoiceId).maybeSingle();
  const total = Number(inv?.total_cents ?? 0);
  if (total <= 0) return fail('Add lines first; the schedule splits the total.');
  const deposit = Math.round((total * pct) / 100);
  const today = new Date().toISOString().slice(0, 10);
  const del = await viewer.supabase.from('invoice_installments').delete().eq('invoice_id', invoiceId);
  if (del.error) return failWith(del.error);
  const { error } = await viewer.supabase.from('invoice_installments').insert([
    { org_id: viewer.org.id, invoice_id: invoiceId, label: 'Deposit', amount_cents: deposit, due_on: today },
    { org_id: viewer.org.id, invoice_id: invoiceId, label: 'Balance', amount_cents: total - deposit, due_on: balanceDue },
  ]);
  return settle(error, `Schedule set: ${pct}% now, the rest by ${balanceDue}.`);
}

export async function removeInstallment(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const installmentId = id(form, 'installment_id');
  if (!installmentId) return fail('That payment was not found.');
  const { error } = await viewer.supabase.from('invoice_installments').delete().eq('id', installmentId);
  return settle(error, 'Removed from the schedule.');
}

export async function sendInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const { error } = await viewer.supabase.rpc('send_invoice', { p_invoice: invoiceId });
  return settle(error, 'Invoice sent. It is in the client’s portal now.');
}

export async function voidInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const { error } = await viewer.supabase.rpc('void_invoice', { p_invoice: invoiceId });
  return settle(error, 'Invoice voided.');
}

export async function deleteInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  if (!invoiceId) return fail('That invoice was not found.');
  const { error } = await viewer.supabase.from('invoices').delete().eq('id', invoiceId);
  if (error) return failWith(error);
  await succeed('Draft invoice deleted.');
  redirect('/invoices');
}

export async function recordPayment(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const invoiceId = id(form, 'invoice_id');
  const amount = cents(form, 'amount');
  const method = text(form, 'method');
  if (!invoiceId) return fail('That invoice was not found.');
  if (!amount) return fail('Enter the amount received.');
  if (!method) return fail('Choose how it was paid.');
  const { error } = await viewer.supabase.rpc('record_client_payment', {
    p_invoice: invoiceId,
    p_amount: amount,
    p_method: method,
    p_reference: text(form, 'reference'),
    p_received: text(form, 'received_on'),
  });
  return settle(error, `Payment of $${(amount / 100).toFixed(2)} recorded.`);
}

// ---------------------------------------------------------------- clients

export async function addClient(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const name = text(form, 'name');
  const contact = text(form, 'contact_name');
  const email = text(form, 'email')?.toLowerCase() ?? null;
  if (!name) return fail('Enter the client’s name (a person or a company).');
  if (email && !EMAIL.test(email)) return fail('That email address does not look right.');
  const { data, error } = await viewer.supabase.from('clients').insert({ org_id: viewer.org.id, name }).select('id').single();
  if (error || !data) return failWith(error);
  if (contact || email) {
    const c = await viewer.supabase.from('client_contacts').insert({
      org_id: viewer.org.id,
      client_id: data.id,
      name: contact ?? name,
      email,
      phone: text(form, 'phone'),
      is_primary: true,
    });
    if (c.error) return failWith(c.error);
  }
  await succeed(`${name} added.`);
  redirect(`/clients/${String(data.id)}`);
}

export async function addContact(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const clientId = id(form, 'client_id');
  const name = text(form, 'name');
  const email = text(form, 'email')?.toLowerCase() ?? null;
  if (!clientId) return fail('That client was not found.');
  if (!name) return fail('Enter the contact’s name.');
  if (email && !EMAIL.test(email)) return fail('That email address does not look right.');
  const { error } = await viewer.supabase.from('client_contacts').insert({ org_id: viewer.org.id, client_id: clientId, name, email, phone: text(form, 'phone') });
  return settle(error, `${name} added.`);
}

export async function inviteClient(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const clientId = id(form, 'client_id');
  const email = text(form, 'email')?.toLowerCase() ?? null;
  if (!clientId) return fail('That client was not found.');
  if (!email || !EMAIL.test(email)) return fail('Enter the email the client will sign in with.');
  const { error } = await viewer.supabase.rpc('invite_client_login', { p_client: clientId, p_email: email });
  if (error) return failWith(error);
  const sent = await sendSignInLink(email);
  if (sent.error) {
    return succeed(
      sent.error.status === 429
        ? `Portal access granted to ${email}, but the email limit was hit. They can sign in at /sign-in with that address.`
        : `Portal access granted to ${email}. The email did not send (${sent.error.message}); they can sign in at /sign-in.`,
    );
  }
  return succeed(`Portal access granted. A sign-in link is on its way to ${email}.`);
}

export async function sendClientMessage(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const clientId = id(form, 'client_id');
  const body = text(form, 'body');
  if (!clientId) return fail('That client was not found.');
  if (!body) return fail('Write a message.');
  const { error } = await viewer.supabase.from('client_messages').insert({ org_id: viewer.org.id, client_id: clientId, author_id: viewer.userId, from_client: false, body });
  return settle(error, 'Message sent. The client sees it in their portal.');
}

// ----------------------------------------------------------- media release

export async function releaseMedia(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  if (!eventId) return fail('That event was not found.');
  const { error } = await viewer.supabase.rpc('release_media', { p_event: eventId, p_message: text(form, 'message') });
  return settle(error, 'Approved media is now in the client’s portal.');
}

// ---------------------------------------------------------------- settings

export async function setClientPayments(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (!viewer.isOwner) return fail('Only an owner can change payment settings.');
  const on = form.get('enabled') === 'on';
  const { error } = await viewer.supabase.from('organizations').update({ client_payments_enabled: on }).eq('id', viewer.org.id);
  return settle(error, on ? 'Card payments switched on for client invoices.' : 'Card payments switched off. Record payments by hand.');
}
