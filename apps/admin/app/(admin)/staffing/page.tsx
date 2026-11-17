import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Empty, LinkButton, Muted, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { EVENT_STATUS, dateTime, isCommitted } from '@/lib/format';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Staffing' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; title: string; status: string; starts_at: string; time_zone: string;
  slots: Array<{ id: string; role: string; status: string; is_required: boolean; staffing_mode: string; assignments: Array<{ status: string }> }>;
};

export default async function StaffingIndex() {
  const viewer = await requireAdmin();
  const { data, error } = await viewer.supabase
    .from('events')
    .select('id, title, status, starts_at, time_zone, slots!slots_event_id_fkey ( id, role, status, is_required, staffing_mode, assignments!assignments_slot_id_fkey ( status ) )')
    .eq('org_id', viewer.org.id)
    .in('status', ['draft', 'staffing', 'staffed'])
    .order('starts_at');
  if (error) throw new Error(`Could not load events: ${error.message}`);
  const events = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Staffing" subtitle="Every event still being crewed. Pick one to invite, review interest and select." actions={<LinkButton href="/events/new">New event</LinkButton>} />
      {events.length === 0 ? (
        <Empty title="Nothing to staff">Every upcoming event is crewed. New events appear here as drafts.</Empty>
      ) : (
        <Table head={['Event', 'When', 'Status', 'Confirmed', 'Waiting on you', '']} minWidth={820}>
          {events.map((e) => {
            const slots = e.slots.filter((s) => s.status !== 'cancelled');
            const required = slots.filter((s) => s.is_required);
            const confirmed = required.filter((s) => s.assignments.some((a) => isCommitted(a.status))).length;
            const interested = slots.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'interested').length, 0);
            const selected = slots.reduce((n, s) => n + s.assignments.filter((a) => a.status === 'selected').length, 0);
            const st = EVENT_STATUS[e.status] ?? { label: e.status, tone: 'muted' as const };
            return (
              <tr key={e.id}>
                <td style={td}>
                  <Link href={`/events/${e.id}`} style={{ fontWeight: 700, color: color.text }}>{e.title}</Link>
                </td>
                <td style={td}>{dateTime(e.starts_at, e.time_zone)}</td>
                <td style={td}><Tag tone={st.tone}>{st.label}</Tag></td>
                <td style={td}>{confirmed} of {required.length}</td>
                <td style={td}>
                  {interested ? <span style={{ color: color.label, fontWeight: 700 }}>{interested} interested</span> : null}
                  {interested && selected ? ' · ' : ''}
                  {selected ? <span style={{ color: color.warnText }}>{selected} awaiting confirm</span> : null}
                  {!interested && !selected ? <Muted size={13}>—</Muted> : null}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <LinkButton href={`/events/${e.id}/staffing`} variant="secondary">Open</LinkButton>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
