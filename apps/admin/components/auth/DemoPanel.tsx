import { demoSignIn } from '@/app/auth-actions';
import { DEMO_ACCOUNTS } from '@/lib/demo';
import { PORTALS, type Portal } from '@/lib/portals';
import { color, fonts, radius } from '@/lib/ui';

/** Demo mode: try each portal as a fictional account, one click each. */
export function DemoPanel({ unavailable }: { unavailable?: boolean }) {
  const order: Portal[] = ['admin', 'contractor', 'client'];
  return (
    <section id="demo" aria-label="Demo mode" style={{ width: '100%', border: `2px dashed ${color.label}`, borderRadius: radius.xxl, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, background: color.surface }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: color.label }}>Demo mode</span>
        <strong style={{ fontSize: 17 }}>Try each portal with sample data, no account needed</strong>
        <span style={{ fontSize: 14, color: color.textMuted }}>
          You’ll be signed in as a made-up person. Click around freely: everything works except sending emails and changing sign-in details.
        </span>
        {unavailable ? <span role="alert" style={{ fontSize: 14, color: color.warnText }}>The demo sign-in is not available right now.</span> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
        {order.map((p) => (
          <form key={p} action={demoSignIn}>
            <input type="hidden" name="portal" value={p} />
            <button type="submit" style={{ width: '100%', minHeight: 64, borderRadius: radius.lg, border: `1px solid ${color.border}`, background: color.bg, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2, padding: '10px 14px', textAlign: 'left' }}>
              <span style={{ fontFamily: fonts.label, fontWeight: 600, fontSize: 15, color: color.text }}>Demo {PORTALS[p].title.toLowerCase()} →</span>
              <span style={{ fontSize: 12, color: color.textMuted }}>as {DEMO_ACCOUNTS[p].who}</span>
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
