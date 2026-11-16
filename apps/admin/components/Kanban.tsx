import type { Card, Column } from '@/lib/board/build';
import { card as cardStyle, color, radius, toneColor } from '@/lib/ui';

/**
 * UI-SPEC section 3, `EventCard`. A card that is waiting on the producer gets
 * the label-coloured border. It is not a link yet: the staffing and review
 * pages it should open do not exist, and a link that goes nowhere is worse
 * than no link.
 */
function EventCard({ card }: { card: Card }) {
  return (
    <div
      style={{
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
    </div>
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
        <EventCard key={c.id} card={c} />
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

/** Six columns in a box that scrolls sideways on its own (UI-SPEC section 5). */
export function Kanban({ columns }: { columns: Column[] }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`,
          gap: 14,
          minWidth: columns.length * 230,
        }}
      >
        {columns.map((column) => (
          <KanbanColumn key={column.status} column={column} />
        ))}
      </div>
    </div>
  );
}
