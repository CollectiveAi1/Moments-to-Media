import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Empty, H2, LinkButton, Muted, Table, Tag, td } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { ASSIGNMENT_STATUS, bytes, dateTime } from '@/lib/format';
import { color } from '@/lib/ui';

export const metadata: Metadata = { title: 'Footage and review' };
export const dynamic = 'force-dynamic';

type Assignment = {
  id: string; user_id: string; status: string; updated_at: string;
  slots: { role: string; events: { id: string; title: string; starts_at: string; time_zone: string } };
  uploads: Array<{ id: string; status: string; bytes: number | null }>;
};

export default async function FootagePage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: eventFilter } = await searchParams;
  const viewer = await requireAdmin();
  const db = viewer.supabase;

  const [{ data: queueRows }, { data: uploadRows }, { data: events }] = await Promise.all([
    db.from('assignments')
      .select('id, user_id, status, updated_at, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( id, title, starts_at, time_zone ) ), uploads!uploads_assignment_id_fkey ( id, status, bytes )')
      .eq('org_id', viewer.org.id)
      .in('status', ['uploaded', 'changes_requested'])
      .order('updated_at'),
    db
        .from('uploads')
        .select('id, filename, kind, bytes, completed_at, assignment_id, assignments!uploads_assignment_id_fkey ( user_id, slots!assignments_slot_id_fkey ( role, events!slots_event_id_fkey ( id, title, time_zone ) ) )')
        .eq('org_id', viewer.org.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(500),
    db.from('events').select('id, title').eq('org_id', viewer.org.id).in('status', ['in_progress', 'uploaded', 'complete']).order('starts_at', { ascending: false }),
  ]);

  const queue = (queueRows ?? []) as unknown as Assignment[];
  // Filtered here rather than in the query: a filter two embeds deep empties
  // the nested row instead of dropping the upload.
  const uploads = (uploadRows ?? []).filter((u) => {
    const a = u.assignments as unknown as { slots?: { events?: { id: string } } } | null;
    return a?.slots?.events && (!eventFilter || a.slots.events.id === eventFilter);
  });
  const userIds = [...new Set([...queue.map((a) => a.user_id), ...uploads.map((u) => String((u.assignments as unknown as { user_id: string }).user_id))])];
  const { data: profiles } = userIds.length ? await db.from('profiles').select('user_id, full_name').in('user_id', userIds) : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [String(p.user_id), String(p.full_name)]));

  return (
    <>
      <PageHeader title="Footage and review" subtitle="Approve deliverables, request changes and download what has landed." />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <H2 size={20}>Waiting for review</H2>
        {queue.length === 0 ? (
          <Empty title="Nothing to review">When a contractor marks their upload complete, it appears here.</Empty>
        ) : (
          <Table head={['Event', 'Role', 'Contractor', 'Files', 'Status', '']} minWidth={820}>
            {queue.map((a) => {
              const files = a.uploads.filter((u) => u.status === 'completed');
              const st = ASSIGNMENT_STATUS[a.status] ?? { label: a.status, tone: 'muted' as const };
              return (
                <tr key={a.id}>
                  <td style={td}>
                    <Link href={`/events/${a.slots.events.id}`} style={{ fontWeight: 700, color: color.text }}>{a.slots.events.title}</Link>
                    <div><Muted size={12}>{dateTime(a.slots.events.starts_at, a.slots.events.time_zone)}</Muted></div>
                  </td>
                  <td style={td}>{a.slots.role}</td>
                  <td style={td}>{names.get(a.user_id) ?? 'Contractor'}</td>
                  <td style={td}>{files.length} · {bytes(files.reduce((n, f) => n + Number(f.bytes ?? 0), 0))}</td>
                  <td style={td}><Tag tone={a.status === 'uploaded' ? 'label' : 'warn'}>{a.status === 'uploaded' ? 'Ready for review' : st.label}</Tag></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <LinkButton href={`/events/${a.slots.events.id}/review/${a.id}`} variant={a.status === 'uploaded' ? 'admin' : 'secondary'}>
                      {a.status === 'uploaded' ? 'Review' : 'Open'}
                    </LinkButton>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <H2 size={20}>Footage library</H2>
          <form style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 14, color: color.textMuted, display: 'flex', gap: 8, alignItems: 'center' }}>
              Event
              <select name="event" defaultValue={eventFilter ?? ''} style={{ minHeight: 40, borderRadius: 8, border: `1px solid ${color.border}`, background: color.surface, padding: '0 8px' }}>
                <option value="">All events</option>
                {(events ?? []).map((e) => (
                  <option key={String(e.id)} value={String(e.id)}>{String(e.title)}</option>
                ))}
              </select>
            </label>
            <button type="submit" style={{ minHeight: 40, padding: '0 12px', borderRadius: 8, border: `1px solid ${color.border}`, background: 'transparent', cursor: 'pointer' }}>Filter</button>
          </form>
        </div>
        {uploads.length === 0 ? (
          <Empty title="No footage yet">Files appear here once they have landed in storage and been verified.</Empty>
        ) : (
          <Table head={['File', 'Event', 'Contractor', 'Kind', 'Size', 'Landed', '']} minWidth={900}>
            {uploads.map((u) => {
              const a = u.assignments as unknown as { user_id: string; slots: { role: string; events: { id: string; title: string; time_zone: string } } };
              return (
                <tr key={String(u.id)}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>{String(u.filename)}</td>
                  <td style={td}>{a.slots.events.title}</td>
                  <td style={td}>{names.get(a.user_id) ?? 'Contractor'} · {a.slots.role}</td>
                  <td style={td}>{String(u.kind)}</td>
                  <td style={td}>{bytes(Number(u.bytes))}</td>
                  <td style={td}>{u.completed_at ? dateTime(String(u.completed_at), a.slots.events.time_zone) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <a href={`/download/${String(u.id)}`} style={{ fontSize: 14 }}>Download</a>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>
    </>
  );
}
