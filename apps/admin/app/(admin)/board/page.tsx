import type { Metadata } from 'next';
import { AttentionStrip } from '@/components/AttentionStrip';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Kanban } from '@/components/Kanban';
import { PageHeader } from '@/components/PageHeader';
import { ProducerFilter } from '@/components/ProducerFilter';
import { buildBoard, formatDay, type AttentionItem } from '@/lib/board/build';
import { LinkButton } from '@/components/ui';
import { loadBoard } from '@/lib/board/query';
import { requireAdmin } from '@/lib/context';
import { card, color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Operations board', description: 'Every event by status, with what needs attention today.' };
// Always the live state: this page is the producer's picture of right now.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The zone most events are in, so "today" in the header means their today. */
function homeZone(zones: string[]): string {
  const counts = new Map<string, number>();
  for (const z of zones) counts.set(z, (counts.get(z) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTC';
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ producer?: string }>;
}) {
  const { producer } = await searchParams;
  const producerId = producer && UUID.test(producer) ? producer : null;

  const viewer = await requireAdmin();
  const { events, names, producers } = await loadBoard(viewer.supabase, producerId);

  // Running late and off-site check-ins are sent to the producer as
  // notifications by the database; the last twelve hours of them belong here.
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const { data: notices } = await viewer.supabase
    .from('notifications')
    .select('id, type, payload, created_at')
    .in('type', ['running_late', 'checked_in_outside_radius'])
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  const live: AttentionItem[] = (notices ?? []).map((n) => {
    const p = (n.payload ?? {}) as { contractor_name?: string; event_title?: string; eta_minutes?: number; distance_m?: number };
    return n.type === 'running_late'
      ? { key: `late-${n.id}`, tone: 'warn', text: `${p.contractor_name ?? 'A contractor'} running late · ${p.event_title ?? ''}, ETA ${p.eta_minutes ?? '?'} min` }
      : { key: `far-${n.id}`, tone: 'danger', text: `${p.contractor_name ?? 'A contractor'} checked in ${p.distance_m ?? '?'} m from the venue · ${p.event_title ?? ''}` };
  });

  const now = new Date();
  const board = buildBoard(events, now, (id) => names.get(id) ?? 'A contractor');
  const today = formatDay(now.toISOString(), homeZone(events.map((e) => e.timeZone)));
  const active = `${board.activeCount} active ${board.activeCount === 1 ? 'event' : 'events'}`;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Operations board"
        subtitle={`${today} · ${active}`}
        actions={
          <>
            <ProducerFilter producers={producers} selected={producerId} />
            <LinkButton href="/events/new">New event</LinkButton>
          </>
        }
      />

      {events.length === 0 ? (
        <section style={{ ...card(radius.lg), padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 22, fontWeight: 600 }}>
            {producerId ? 'No events for this producer' : 'No events yet'}
          </h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>
            {producerId
              ? 'Choose Everyone to see the whole board.'
              : 'Events appear here as soon as one is created. Start one with New event.'}
          </p>
        </section>
      ) : (
        <>
          <AttentionStrip items={[...live, ...board.attention]} />
          <Kanban columns={board.columns} />
        </>
      )}
    </>
  );
}
