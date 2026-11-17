import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, H1, Table, Tag, td } from '@/components/ui';
import { requireClient } from '@/lib/context';
import { INVOICE_STATUS, money } from '@/lib/format';
import { myClientIds } from '@/lib/portal/load';

export const metadata: Metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

export default async function PortalInvoices() {
  const viewer = await requireClient();
  const ids = (await myClientIds(viewer)).map((c) => c.id);
  const { data } = ids.length
    ? await viewer.supabase.from('invoices').select('id, number, title, status, total_cents, paid_cents').in('client_id', ids).neq('status', 'draft').order('created_at', { ascending: false })
    : { data: [] };
  return (
    <>
      <H1>Invoices</H1>
      {(data ?? []).length === 0 ? (
        <Empty title="No invoices yet" />
      ) : (
        <Table head={['#', 'For', 'Total', 'Paid', 'Status']} minWidth={560}>
          {(data ?? []).map((i) => {
            const st = INVOICE_STATUS[String(i.status)] ?? { label: String(i.status), tone: 'muted' as const };
            return (
              <tr key={String(i.id)}>
                <td style={td}>{String(i.number)}</td>
                <td style={td}><Link href={`/portal/invoices/${String(i.id)}`} style={{ fontWeight: 600 }}>{String(i.title)}</Link></td>
                <td style={td}>{money(Number(i.total_cents))}</td>
                <td style={td}>{money(Number(i.paid_cents))}</td>
                <td style={td}><Tag tone={st.tone}>{st.label}</Tag></td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
