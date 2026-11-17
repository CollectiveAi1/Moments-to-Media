import { color, radius } from '@/lib/ui';

/** What a page shows while its data loads: an announced status and quiet placeholders. */
export function PageLoading({ label = 'Loading' }: { label?: string }) {
  const bar = (w: string, h = 16) => <div style={{ width: w, height: h, borderRadius: radius.sm, background: color.divider }} />;
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {bar('40%', 30)}
        {bar('60%')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 120, borderRadius: radius.lg, background: color.surface, border: `1px solid ${color.border}` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
