import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { BackLink, Card, H1, H2, ListRow, Muted, Notice, StatusText, Tag } from '@/components/ui';
import { allocate, amountDueNow, todayIn } from '@/lib/billing/schedule';
import { requireClient } from '@/lib/context';
import { INVOICE_STATUS, PAYMENT_METHOD, dateTime, money } from '@/lib/format';
import { color } from '@/lib/ui';
import { payInvoice } from '../../actions';

export const metadata: Metadata = { title: 'Invoice', description: 'Invoice details, payment schedule and receipts.' };
export const dynamic = 'force-dynamic';

const STATE_LABEL = { paid: 'Paid', partly_paid: 'Partly paid', overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming' } as const;
const STATE_TONE = { paid: 'positive', partly_paid: 'label', overdue: 'warn', due: 'warn', upcoming: 'muted' } as const;

export default async function PortalInvoice({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ paid?: string; cancelled?: string }> }) {
  const { invoiceId } = await params;
  const { paid: justPaid, cancelled } = await searchParams;
  const viewer = await requireClient();
  const db = viewer.supabase;
  const [{ data: inv }, { data: lines }, { data: inst }, { data: payments }, { data: org }] = await Promise.all([
    db.from('invoices').select('id, number, title, notes, status, subtotal_cents, discount_cents, tax_rate_bp, tax_cents, total_cents, paid_cents, sent_at, event_id, proposal_id').eq('id', invoiceId).neq('status', 'draft').maybeSingle(),
    db.from('invoice_lines').select('id, description, quantity, unit_cents').eq('invoice_id', invoiceId).order('sort_order'),
    db.from('invoice_installments').select('id, label, amount_cents, due_on').eq('invoice_id', invoiceId).order('due_on'),
    db.from('client_payments').select('id, amount_cents, method, reference, received_at, status').eq('invoice_id', invoiceId).order('received_at'),
    db.rpc('client_payments_enabled', { p_org: viewer.org.id }),
  ]);
  if (!inv) notFound();

  const total = Number(inv.total_cents);
  const paid = Number(inv.paid_cents);
  const schedule = allocate((inst ?? []).map((i) => ({ id: String(i.id), label: String(i.label), amountCents: Number(i.amount_cents), dueOn: String(i.due_on) })), paid, todayIn('America/New_York'));
  const due = amountDueNow(schedule);
  const live = inv.status === 'open' || inv.status === 'partially_paid';
  const cardsOn = org === true;
  const st = INVOICE_STATUS[String(inv.status)] ?? { label: String(inv.status), tone: 'muted' as const };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const here = `${proto}://${host}/portal/invoices/${invoiceId}`;

  return (
    <>
      <BackLink href="/portal">Overview</BackLink>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <H1>Invoice {String(inv.number)}</H1>
          <Muted>{String(inv.title)} · from {viewer.org.name}</Muted>
        </div>
        <Tag tone={st.tone}>{st.label}</Tag>
      </div>
      {justPaid ? <Notice>Thank you! Your payment is being confirmed and will show here within a minute.</Notice> : null}
      {cancelled ? <Notice tone="warn">Payment was not completed. Nothing was charged.</Notice> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 20, alignItems: 'start' }}>
        <Card>
          {(lines ?? []).map((l) => (
            <ListRow key={String(l.id)} label={`${String(l.description)}${Number(l.quantity) > 1 ? ` × ${String(l.quantity)}` : ''}`} value={money(Number(l.unit_cents) * Number(l.quantity))} />
          ))}
          {Number(inv.discount_cents) ? <ListRow label="Discount" value={`−${money(Number(inv.discount_cents))}`} /> : null}
          {Number(inv.tax_cents) ? <ListRow label={`Tax (${Number(inv.tax_rate_bp) / 100}%)`} value={money(Number(inv.tax_cents))} /> : null}
          <ListRow label={<strong>Total</strong>} value={<strong>{money(total)}</strong>} />
          <ListRow label="Paid" value={money(paid)} />
          <ListRow label={<strong>Balance</strong>} value={<strong>{money(Math.max(total - paid, 0))}</strong>} />
          {inv.notes ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: color.textBody }}>{String(inv.notes)}</p> : null}
          {inv.event_id ? <Link href={`/portal/projects/${String(inv.event_id)}`} style={{ fontSize: 14 }}>View the project and your signed contract →</Link> : null}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {live && due ? (
            <Card highlight>
              <H2 size={20}>{due.label}: {money(due.cents)}</H2>
              {cardsOn ? (
                <>
                  <ActionForm action={payInvoice} submit={`Pay ${money(due.cents)} by card`} variant="primary" height={52} buttonStyle={{ width: '100%' }}>
                    <input type="hidden" name="invoice_id" value={invoiceId} />
                    <input type="hidden" name="amount" value="due" />
                    <input type="hidden" name="return_url" value={here} />
                  </ActionForm>
                  {total - paid > due.cents ? (
                    <ActionForm action={payInvoice} submit={`Pay the full balance (${money(total - paid)})`} variant="secondary" buttonStyle={{ width: '100%' }}>
                      <input type="hidden" name="invoice_id" value={invoiceId} />
                      <input type="hidden" name="amount" value="balance" />
                      <input type="hidden" name="return_url" value={here} />
                    </ActionForm>
                  ) : null}
                  <Muted size={12}>Secure checkout by Stripe. Card, Apple Pay and Google Pay accepted.</Muted>
                </>
              ) : (
                <Muted>
                  To pay, send a check, cash or bank transfer to {viewer.org.name} and mention invoice {String(inv.number)}. It shows here as soon as it’s recorded.
                  {' '}<Link href="/portal/messages">Message us</Link> for payment details.
                </Muted>
              )}
            </Card>
          ) : null}

          <Card>
            <H2 size={20}>Schedule</H2>
            {schedule.length === 0 ? <Muted>Due in full.</Muted> : null}
            {schedule.map((i) => (
              <ListRow
                key={i.id}
                label={<span style={{ display: 'flex', flexDirection: 'column' }}><strong style={{ fontSize: 14 }}>{i.label}</strong><Muted size={13}>Due {i.dueOn}</Muted></span>}
                value={<span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><strong>{money(i.amountCents)}</strong><StatusText tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</StatusText></span>}
              />
            ))}
          </Card>

          <Card>
            <H2 size={20}>Receipts</H2>
            {(payments ?? []).length === 0 ? <Muted>No payments yet.</Muted> : null}
            {(payments ?? []).map((p) => (
              <ListRow key={String(p.id)} label={`${dateTime(String(p.received_at), 'America/New_York')} · ${PAYMENT_METHOD[String(p.method)] ?? String(p.method)}`} value={<strong>{money(Number(p.amount_cents))}</strong>} />
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
