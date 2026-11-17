import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Card, Empty, LinkButton, Muted, Table, Tag, td } from '@/components/ui';
import { allocate, todayIn } from '@/lib/billing/schedule';
import { requireAdmin } from '@/lib/context';
import { INVOICE_STATUS, money } from '@/lib/format';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; number: number; title: string; status: string; total_cents: number; paid_cents: number; created_at: string;
  clients: { name: string } | null;
  invoice_installments: Array<{ id: string; label: string; amount_cents: number; due_on: string }>;
};

export default async function InvoicesPage() {
  const viewer = await requireAdmin();
  const { data } = await viewer.supabase
    .from('invoices')
    .select('id, number, title, status, total_cents, paid_cents, created_at, clients!invoices_client_id_fkey(name), invoice_installments!invoice_installments_invoice_id_fkey(id, label, amount_cents, due_on)')
    .eq('org_id', viewer.org.id)
    .order('created_at', { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayIn('America/New_York');
  const live = rows.filter((r) => r.status === 'open' || r.status === 'partially_paid');
  const outstanding = live.reduce((n, r) => n + (r.total_cents - r.paid_cents), 0);
  const overdue = live.reduce((n, r) => {
    const s = allocate(r.invoice_installments.map((i) => ({ id: i.id, label: i.label, amountCents: i.amount_cents, dueOn: i.due_on })), r.paid_cents, today);
    return n + s.filter((i) => i.state === 'overdue').reduce((m, i) => m + i.remainingCents, 0);
  }, 0);
  const year = today.slice(0, 4);
  const collected = rows.filter((r) => r.created_at.startsWith(year)).reduce((n, r) => n + r.paid_cents, 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle="What clients owe and what they’ve paid." actions={<LinkButton href="/invoices/new">New invoice</LinkButton>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
        <Stat label="Outstanding" value={money(outstanding)} />
        <Stat label="Overdue" value={money(overdue)} warn={overdue > 0} />
        <Stat label={`Collected on ${year} invoices`} value={money(collected)} />
      </div>
      {rows.length === 0 ? (
        <Empty title="No invoices yet">Invoices are created for you when a client signs a proposal. You can also start one by hand.</Empty>
      ) : (
        <Table head={['#', 'Invoice', 'Client', 'Total', 'Paid', 'Status']}>
          {rows.map((r) => {
            const st = INVOICE_STATUS[r.status] ?? { label: r.status, tone: 'muted' as const };
            return (
              <tr key={r.id}>
                <td style={td}>{r.number}</td>
                <td style={td}><Link href={`/invoices/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link></td>
                <td style={td}>{r.clients?.name ?? '—'}</td>
                <td style={td}>{money(r.total_cents)}</td>
                <td style={td}>{money(r.paid_cents)}</td>
                <td style={td}><Tag tone={st.tone}>{st.label}</Tag></td>
              </tr>
            );
          })}
        </Table>
      )}
      <Muted size={13}>Card payments: {''}see Settings. Until they are on, record checks, cash and transfers on each invoice.</Muted>
    </>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card>
      <span style={{ fontSize: 13, color: color.textMuted }}>{label}</span>
      <strong style={{ fontSize: 26, color: warn ? color.attention : color.text }}>{value}</strong>
    </Card>
  );
}
