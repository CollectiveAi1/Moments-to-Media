import { COLUMNS } from '@/lib/board/build';
import { card, color, radius } from '@/lib/ui';

const block = (width: number | string, height: number) => ({
  width,
  height,
  borderRadius: radius.xs,
  background: color.divider,
});

/** Skeletons in the shapes of the real thing (UI-SPEC section 4, intro). */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading the board" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={block(280, 30)} />
        <div style={block(180, 14)} />
      </div>
      <div style={{ ...card(radius.lg), padding: '14px 16px' }}>
        <div style={block(160, 16)} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`,
            gap: 14,
            minWidth: COLUMNS.length * 230,
          }}
        >
          {COLUMNS.map((c) => (
            <div key={c.status} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={block(80, 14)} />
              <div style={{ ...card(radius.md), padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={block('80%', 14)} />
                <div style={block('55%', 12)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
