import Link from 'next/link';
import type { Card, Column, EventStatus } from '@/lib/board/build';
import { card as cardStyle, color, radius, toneColor } from '@/lib/ui';

/**
 * UI-SPEC section 3, `EventCard`. A card that is waiting on the producer gets
 * the label-coloured border and opens where that decision is made: staffing
 * for interest to review, the footage queue for uploads to approve.
 */
function hrefFor(card: Card, status: EventStatus): string {
  if (card.actionable && status === 'staffing') return `/events/${card.id}/staffing`;
  if (card.actionable && status === 'uploaded') return '/footage';
  return `/events/${card.id}`;
}

function EventCard({ card, status }: { card: Card; status: EventStatus }) {
  return (
    <Link
      href={hrefFor(card, status)}
      style={{
        textDecoration: 'none',
        color: color.text,
        ...cardStyle(radius.md),
        borderColor: card.actionable ? color.label : color.border,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700 }}>{card.title}</span>
      <span style={{ fontSize: 12, color: color.textMuted }}>{card.meta}</span>
      {card.lines.map((line) => (
        <span
          key={line.text}
          style={{
            fontSize: 12,
            color: toneColor[line.tone],
            fontWeight: line.tone === 'label' ? 700 : 400,
          }}
        >
          {line.text}
        </span>
      ))}
    </Link>
  );
}

function KanbanColumn({ column }: { column: Column }) {
  const hidden = column.count - column.cards.length;
  return (
    <section aria-label={column.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          color: color.textMuted,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {column.label}
        <span aria-label={`${column.count} events`}>{column.count}</span>
      </h2>
      {column.cards.map((c) => (
        <EventCard key={c.id} card={c} status={column.status} />
      ))}
      {column.count === 0 ? (
        <span style={{ fontSize: 12, color: color.textMuted, padding: '4px 2px' }}>None</span>
      ) : null}
      {hidden > 0 ? (
        <span style={{ fontSize: 12, color: color.textMuted, padding: '4px 2px' }}>
          + {hidden} earlier
        </span>
      ) : null}
    </section>
  );
}

/**
 * Six columns side by side on a wide screen. UI-SPEC section 5 drew a box
 * that scrolls sideways; columns now wrap instead, so the board reflows at
 * 320px wide without two-way scrolling (WCAG 1.4.10).
 */
export function Kanban({ columns }: { columns: Column[] }) {
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
        }}
      >
        {columns.map((column) => (
          <KanbanColumn key={column.status} column={column} />
        ))}
      </div>
    </div>
  );
}
