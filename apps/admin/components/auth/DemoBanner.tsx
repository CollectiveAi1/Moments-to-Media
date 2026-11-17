import { color, fonts } from '@/lib/ui';

/** Shown on every page while a demo account is signed in. */
export function DemoBanner({ who }: { who: string }) {
  return (
    <div role="note" style={{ background: color.label, color: color.onPrimary, fontSize: 13, padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
      <strong style={{ fontFamily: fonts.label, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12 }}>Demo mode</strong>
      <span>Signed in as {who}. Sample data only.</span>
      <form action="/auth/sign-out" method="post" style={{ margin: 0 }}>
        <button type="submit" style={{ minHeight: 30, padding: '0 12px', borderRadius: 6, border: `1px solid ${color.onPrimary}`, background: 'transparent', color: color.onPrimary, fontFamily: fonts.label, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
          Try another portal
        </button>
      </form>
    </div>
  );
}
