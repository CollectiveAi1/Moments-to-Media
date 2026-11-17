import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card, Field, H2, ListRow, Muted, Notice, Row, StatusText, Tag, inputStyle, textareaStyle } from '@/components/ui';
import { allocate, todayIn } from '@/lib/billing/schedule';
import { requireAdmin } from '@/lib/context';
import { INVOICE_STATUS, PAYMENT_METHOD, dateTime, money } from '@/lib/format';
import { color } from '@/lib/ui';
import {
  addInstallment, addInvoiceLine, deleteInvoice, recordPayment, removeInstallment, removeInvoiceLine, sendInvoice, splitInvoice, updateInvoice, updateInvoiceNotes, voidInvoice,
} from '../../client-actions';

export const metadata: Metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

const STATE_LABEL = { paid: 'Paid', partly_paid: 'Partly paid', overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming' } as const;
const STATE_TONE = { paid: 'positive', partly_paid: 'label', overdue: 'warn', due: 'warn', upcoming: 'muted' } as const;

export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const viewer = await requireAdmin();
  const [{ data: inv }, { data: lines }, { data: inst }, { data: payments }, { data: packages }] = await Promise.all([
    viewer.supabase.from('invoices').select('*, clients!invoices_client_id_fkey(id, name), events(id, title)').eq('id', invoiceId).maybeSingle(),
    viewer.supabase.from('invoice_lines').select('id, description, quantity, unit_cents').eq('invoice_id', invoiceId).order('sort_order').order('created_at'),
    viewer.supabase.from('invoice_installments').select('id, label, amount_cents, due_on').eq('invoice_id', invoiceId).order('due_on'),
    viewer.supabase.from('client_payments').select('id, amount_cents, method, status, reference, received_at').eq('invoice_id', invoiceId).order('received_at'),
    viewer.supabase.from('packages').select('id, name, price_cents, is_addon').eq('org_id', viewer.org.id).eq('active', true).order('is_addon').order('sort_order'),
  ]);
  if (!inv) notFound();

  const client = inv.clients as { id: string; name: string } | null;
  const event = inv.events as { id: string; title: string } | null;
  const draft = inv.status === 'draft';
  const live = inv.status === 'open' || inv.status === 'partially_paid';
  const st = INVOICE_STATUS[String(inv.status)] ?? { label: String(inv.status), tone: 'muted' as const };
  const total = Number(inv.total_cents);
  const paid = Number(inv.paid_cents);
  const schedule = allocate((inst ?? []).map((i) => ({ id: String(i.id), label: String(i.label), amountCents: Number(i.amount_cents), dueOn: String(i.due_on) })), paid, todayIn('America/New_York'));
  const scheduled = schedule.reduce((n, i) => n + i.amountCents, 0);

  return (
    <>
      <BackLink href="/invoices">Invoices</BackLink>
      <PageHeader
        title={`Invoice ${String(inv.number)}`}
        subtitle={`${String(inv.title)} · ${client?.name ?? ''}`}
        actions={<Tag tone={st.tone}>{st.label}</Tag>}
      />
      <Row align="center">
        {client ? <Link href={`/clients/${client.id}`}>Client: {client.name}</Link> : null}
        {event ? <Link href={`/events/${event.id}`}>Event: {event.title}</Link> : null}
        {inv.proposal_id ? <Link href={`/proposals/${String(inv.proposal_id)}`}>From the signed proposal</Link> : null}
      </Row>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20, alignItems: 'start' }}>
        <Card>
          <H2 size={20}>Lines</H2>
          {(lines ?? []).length === 0 ? <Muted>No lines yet.</Muted> : null}
          {(lines ?? []).map((l) => (
            <div key={String(l.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', borderBottom: `1px solid ${color.divider}`, paddingBottom: 8 }}>
              <span style={{ flex: 1 }}>{String(l.description)}{Number(l.quantity) > 1 ? ` × ${String(l.quantity)}` : ''}</span>
              <strong>{money(Number(l.unit_cents) * Number(l.quantity))}</strong>
              {draft ? (
                <ActionForm action={removeInvoiceLine} submit="Remove" variant="secondary" layout="inline" height={32}>
                  <input type="hidden" name="line_id" value={String(l.id)} />
                </ActionForm>
              ) : null}
            </div>
          ))}
          <ListRow label="Subtotal" value={money(Number(inv.subtotal_cents))} />
          {Number(inv.discount_cents) ? <ListRow label="Discount" value={`−${money(Number(inv.discount_cents))}`} /> : null}
          {Number(inv.tax_cents) ? <ListRow label={`Tax (${Number(inv.tax_rate_bp) / 100}%)`} value={money(Number(inv.tax_cents))} /> : null}
          <ListRow label={<strong>Total</strong>} value={<strong>{money(total)}</strong>} />
          <ListRow label="Paid" value={money(paid)} />
          <ListRow label={<strong>Balance</strong>} value={<strong>{money(Math.max(total - paid, 0))}</strong>} />

          {draft ? (
            <>
              <ActionForm action={addInvoiceLine} submit="Add line" reset>
                <input type="hidden" name="invoice_id" value={String(inv.id)} />
                <Field label="From your packages">
                  <select name="package_id" defaultValue="" style={inputStyle}>
                    <option value="">A custom line (below)</option>
                    {(packages ?? []).map((k) => <option key={String(k.id)} value={String(k.id)}>{String(k.name)} · {money(Number(k.price_cents))}</option>)}
                  </select>
                </Field>
                <Row>
                  <Field label="Description" grow={2}><input name="description" style={inputStyle} /></Field>
                  <Field label="Price ($)"><input name="price" inputMode="decimal" style={inputStyle} /></Field>
                  <Field label="Qty"><input name="quantity" type="number" min={1} defaultValue={1} style={inputStyle} /></Field>
                </Row>
              </ActionForm>
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label, minHeight: 36, display: 'flex', alignItems: 'center' }}>Title, tax and discount</summary>
                <ActionForm action={updateInvoice} submit="Save" style={{ paddingTop: 8 }}>
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                  <Field label="Title"><input name="title" required defaultValue={String(inv.title)} style={inputStyle} /></Field>
                  <Row>
                    <Field label="Tax (%)"><input name="tax_percent" inputMode="decimal" defaultValue={String(Number(inv.tax_rate_bp) / 100)} style={inputStyle} /></Field>
                    <Field label="Discount ($)"><input name="discount" inputMode="decimal" defaultValue={(Number(inv.discount_cents) / 100).toFixed(2)} style={inputStyle} /></Field>
                  </Row>
                  <Field label="Note on the invoice"><textarea name="notes" defaultValue={String(inv.notes ?? '')} style={textareaStyle} /></Field>
                </ActionForm>
              </details>
            </>
          ) : (
            <ActionForm action={updateInvoiceNotes} submit="Save note" variant="secondary">
              <input type="hidden" name="invoice_id" value={String(inv.id)} />
              <Field label="Note on the invoice"><textarea name="notes" defaultValue={String(inv.notes ?? '')} style={textareaStyle} /></Field>
            </ActionForm>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <H2 size={20}>Payment schedule</H2>
            {schedule.length === 0 ? <Muted>{draft ? 'No schedule yet: it will be due in full on receipt.' : 'Due in full.'}</Muted> : null}
            {schedule.map((i) => (
              <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderBottom: `1px solid ${color.divider}`, paddingBottom: 8 }}>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ fontSize: 14 }}>{i.label}</strong>
                  <Muted size={13}>Due {i.dueOn}</Muted>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <strong>{money(i.amountCents)}</strong>
                  {draft ? null : <StatusText tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</StatusText>}
                </span>
                {draft ? (
                  <ActionForm action={removeInstallment} submit="Remove" variant="secondary" layout="inline" height={32}>
                    <input type="hidden" name="installment_id" value={i.id} />
                  </ActionForm>
                ) : null}
              </div>
            ))}
            {draft && schedule.length > 0 && scheduled !== total ? (
              <Notice tone="warn">The schedule adds up to {money(scheduled)} but the total is {money(total)}.</Notice>
            ) : null}
            {draft ? (
              <>
                <ActionForm action={splitInvoice} submit="Set deposit and balance" variant="secondary">
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                  <Row>
                    <Field label="Deposit now (%)"><input name="deposit_percent" type="number" min={1} max={99} defaultValue={30} style={inputStyle} /></Field>
                    <Field label="Balance due"><input name="balance_due" type="date" style={inputStyle} /></Field>
                  </Row>
                </ActionForm>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 14, color: color.label }}>Add a payment by hand</summary>
                  <ActionForm action={addInstallment} submit="Add" reset style={{ paddingTop: 8 }}>
                    <input type="hidden" name="invoice_id" value={String(inv.id)} />
                    <Row>
                      <Field label="Label"><input name="label" style={inputStyle} placeholder="Second installment" /></Field>
                      <Field label="Amount ($)"><input name="amount" inputMode="decimal" style={inputStyle} /></Field>
                      <Field label="Due"><input name="due_on" type="date" style={inputStyle} /></Field>
                    </Row>
                  </ActionForm>
                </details>
              </>
            ) : null}
          </Card>

          {draft ? (
            <Card>
              <Row align="center">
                <ActionForm action={sendInvoice} submit="Send to client" variant="primary" confirm="Send it? The client will see it in their portal and lines can no longer change.">
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                </ActionForm>
                <ActionForm action={deleteInvoice} submit="Delete draft" variant="secondary" confirm="Delete this draft invoice?">
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                </ActionForm>
              </Row>
            </Card>
          ) : null}

          {!draft ? (
            <Card>
              <H2 size={20}>Payments</H2>
              {(payments ?? []).length === 0 ? <Muted>Nothing received yet.</Muted> : null}
              {(payments ?? []).map((pm) => (
                <ListRow
                  key={String(pm.id)}
                  label={`${PAYMENT_METHOD[String(pm.method)] ?? String(pm.method)}${pm.reference ? ` · ${String(pm.reference)}` : ''} · ${dateTime(String(pm.received_at), 'America/New_York')}`}
                  value={<strong>{money(Number(pm.amount_cents))}</strong>}
                />
              ))}
              {live ? (
                <ActionForm action={recordPayment} submit="Record payment" reset>
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                  <Row>
                    <Field label="Amount ($)"><input name="amount" inputMode="decimal" required defaultValue={((total - paid) / 100).toFixed(2)} style={inputStyle} /></Field>
                    <Field label="How">
                      <select name="method" defaultValue="check" style={inputStyle}>
                        {Object.entries(PAYMENT_METHOD).filter(([k]) => k !== 'card').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="Received"><input name="received_on" type="date" style={inputStyle} /></Field>
                    <Field label="Reference"><input name="reference" style={inputStyle} placeholder="Check #1042" /></Field>
                  </Row>
                </ActionForm>
              ) : null}
              {live && viewer.isOwner && paid === 0 ? (
                <ActionForm action={voidInvoice} submit="Void invoice" variant="secondary" confirm="Void this invoice? The client will see it as void.">
                  <input type="hidden" name="invoice_id" value={String(inv.id)} />
                </ActionForm>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
