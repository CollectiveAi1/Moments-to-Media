import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Empty, LinkButton, Muted, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { EVENT_STATUS, dateTime, isCommitted } from '@/lib/format';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Events' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Drafts' },
  { key: 'complete', label: 'Complete' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
] as const;

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const viewer = await requireAdmin();
  const { show = 'active' } = await searchParams;

  let query = viewer.supabase
    .from('events')
    .select('id, title, status, starts_at, time_zone, venue_name, area_label, producer_id, slots!slots_event_id_fkey ( id, is_required, status, assignments!assignments_slot_id_fkey ( status ) )')
    .eq('org_id', viewer.org.id)
    .order('starts_at', { ascending: show !== 'complete' });
  if (show === 'active') query = query.in('status', ['staffing', 'staffed', 'in_progress', 'uploaded']);
  else if (show !== 'all') query = query.eq('status', show);

  const { data: events, error } = await query;
  if (error) throw new Error(`Could not load events: ${error.message}`);

  const producerIds = [...new Set((events ?? []).map((e) => String(e.producer_id)))];
  const { data: profiles } = producerIds.length
    ? await viewer.supabase.from('profiles').select('user_id, full_name').in('user_id', producerIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [String(p.user_id), String(p.full_name)]));

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Every event in the organization. Open one to edit its details, slots, brief and shot list."
        actions={<LinkButton href="/events/new">New event</LinkButton>}
      />
      <nav aria-label="Filter events" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = f.key === show;
          return (
            <Link
              key={f.key}
              href={`/events?show=${f.key}`}
              aria-current={on ? 'page' : undefined}
              style={{
                minHeight: 36,
                padding: '0 14px',
                borderRadius: 18,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                border: on ? 0 : `1px solid ${color.border}`,
                background: on ? color.primary : 'transparent',
                color: on ? color.onPrimary : color.textSecondary,
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {(events ?? []).length === 0 ? (
        <Empty title="No events here">
          {show === 'active' ? 'Nothing is being staffed or run right now. ' : ''}Create one with New event.
        </Empty>
      ) : (
        <Table head={['Event', 'When', 'Status', 'Producer', 'Crew']} minWidth={760}>
          {(events ?? []).map((e) => {
            const slots = ((e.slots ?? []) as Array<{ is_required: boolean; status: string; assignments: Array<{ status: string }> }>).filter((s) => s.status !== 'cancelled');
            const filled = slots.filter((s) => s.assignments.some((a) => isCommitted(a.status))).length;
            const status = EVENT_STATUS[String(e.status)] ?? { label: String(e.status), tone: 'muted' as const };
            return (
              <tr key={String(e.id)}>
                <td style={td}>
                  <Link href={`/events/${e.id}`} style={{ fontWeight: 700, color: color.text }}>
                    {String(e.title)}
                  </Link>
                  <div>
                    <Muted size={12}>{String(e.venue_name ?? e.area_label ?? 'No venue yet')}</Muted>
                  </div>
                </td>
                <td style={td}>{dateTime(String(e.starts_at), String(e.time_zone))}</td>
                <td style={td}>
                  <Tag tone={status.tone}>{status.label}</Tag>
                </td>
                <td style={td}>{names.get(String(e.producer_id)) ?? '—'}</td>
                <td style={td}>
                  {filled} of {slots.length} filled
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
