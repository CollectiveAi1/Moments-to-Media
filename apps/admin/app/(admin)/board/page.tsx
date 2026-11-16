import type { Metadata } from 'next';
import { AttentionStrip } from '@/components/AttentionStrip';
import { Kanban } from '@/components/Kanban';
import { PageHeader } from '@/components/PageHeader';
import { ProducerFilter } from '@/components/ProducerFilter';
import { buildBoard, formatDay } from '@/lib/board/build';
import { loadBoard } from '@/lib/board/query';
import { createClient } from '@/lib/supabase/server';
import { card, color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Operations board' };
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

  const supabase = await createClient();
  const { events, names, producers } = await loadBoard(supabase, producerId);

  const now = new Date();
  const board = buildBoard(events, now, (id) => names.get(id) ?? 'A contractor');
  const today = formatDay(now.toISOString(), homeZone(events.map((e) => e.timeZone)));
  const active = `${board.activeCount} active ${board.activeCount === 1 ? 'event' : 'events'}`;

  return (
    <>
      <PageHeader
        title="Operations board"
        subtitle={`${today} · ${active}`}
        actions={
          <>
            <ProducerFilter producers={producers} selected={producerId} />
            <button
              type="button"
              disabled
              title="The event builder is not built yet"
              style={{
                height: 44,
                padding: '0 16px',
                borderRadius: radius.sm,
                border: 0,
                background: color.divider,
                color: color.textMuted,
                fontFamily: fonts.label,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              New event
            </button>
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
              : 'Events appear here as soon as one is created. The event builder is the next screen to be built.'}
          </p>
        </section>
      ) : (
        <>
          <AttentionStrip items={board.attention} />
          <Kanban columns={board.columns} />
        </>
      )}
    </>
  );
}
