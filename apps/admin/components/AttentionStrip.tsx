import type { AttentionItem } from '@/lib/board/build';
import { card, color, radius } from '@/lib/ui';

const tag = {
  danger: { background: color.dangerBg, color: color.dangerText },
  warn: { background: color.warnBg, color: color.warnText },
} as const;

/** UI-SPEC section 3, `AttentionStrip`. The count is text, never colour alone. */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  return (
    <section
      aria-label="Needs attention"
      style={{
        ...card(radius.lg),
        padding: '14px 16px',
        display: 'flex',
        gap: '12px 24px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>
        {items.length === 0
          ? 'Nothing needs attention'
          : `${items.length} ${items.length === 1 ? 'needs' : 'need'} attention`}
      </span>
      {items.map((item) => (
        <span
          key={item.key}
          style={{ fontSize: 13, padding: '4px 10px', borderRadius: radius.xs, ...tag[item.tone] }}
        >
          {item.text}
        </span>
      ))}
    </section>
  );
}
