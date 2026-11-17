import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Empty, LinkButton, Muted, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { PROPOSAL_STATUS, dateTime, formatDay } from '@/lib/format';

export const metadata: Metadata = { title: 'Proposals' };
export const dynamic = 'force-dynamic';

export default async function ProposalsPage() {
  const viewer = await requireAdmin();
  const { data } = await viewer.supabase
    .from('proposals')
    .select('id, title, client_name, status, event_starts_at, time_zone, sent_at, viewed_at, responded_at, created_at')
    .eq('org_id', viewer.org.id)
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const waiting = rows.filter((r) => r.status === 'sent' || r.status === 'viewed').length;

  return (
    <>
      <PageHeader
        title="Proposals"
        subtitle={waiting ? `${waiting} waiting on the client` : 'Packages, contract and deposit in one link the client signs.'}
        actions={<LinkButton href="/proposals/new">New proposal</LinkButton>}
      />
      {rows.length === 0 ? (
        <Empty title="No proposals yet">Start one from an inquiry, or with New proposal.</Empty>
      ) : (
        <Table head={['Proposal', 'Client', 'Event date', 'Status', 'Last activity']}>
          {rows.map((r) => {
            const st = PROPOSAL_STATUS[String(r.status)] ?? { label: String(r.status), tone: 'muted' as const };
            const last = (r.responded_at ?? r.viewed_at ?? r.sent_at ?? r.created_at) as string;
            return (
              <tr key={String(r.id)}>
                <td style={td}><Link href={`/proposals/${String(r.id)}`} style={{ fontWeight: 600 }}>{String(r.title)}</Link></td>
                <td style={td}>{String(r.client_name)}</td>
                <td style={td}>{formatDay(String(r.event_starts_at), String(r.time_zone))}</td>
                <td style={td}><Tag tone={st.tone}>{st.label}</Tag></td>
                <td style={td}><Muted size={13}>{dateTime(last, String(r.time_zone))}</Muted></td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
