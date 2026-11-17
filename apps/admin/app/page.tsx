import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoPanel } from '@/components/auth/DemoPanel';
import { Wordmark } from '@/components/Wordmark';
import { demoEnabled } from '@/lib/demo';
import { getViewer } from '@/lib/context';
import { PORTALS, type Portal } from '@/lib/portals';
import { createClient } from '@/lib/supabase/server';
import { card, color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Sign in', description: 'Sign in to Moments to Media: the admin console, the crew app, or your client portal.' };
export const dynamic = 'force-dynamic';

/**
 * Signed out: choose a portal. Signed in: straight to the portal the account
 * belongs to (owners and producers to the board, crew to their app, clients
 * to their portal).
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string; signed_out?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const viewer = await getViewer();
    if (viewer.isAdmin) redirect('/board');
    if (viewer.isContractor) redirect('/app');
    if (viewer.orgs.some((o) => o.roles.includes('client'))) redirect('/portal');
    if (viewer.pendingContractor) redirect('/pending');
    redirect('/no-access');
  }

  const order: Portal[] = ['client', 'contractor', 'admin'];
  const { data: forms } = await supabase.rpc('signup_orgs', { p_role: 'client' });
  const inquireSlug = ((forms ?? []) as Array<{ slug: string }>)[0]?.slug ?? null;
  const { demo, signed_out: signedOut } = await searchParams;
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100vh', background: color.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'center' }}>
        <Wordmark />
        {inquireSlug ? (
          <section aria-label="Book a shoot" style={{ width: '100%', background: color.primary, color: color.onPrimary, borderRadius: radius.xxl, padding: '22px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ fontFamily: fonts.heading, fontSize: 24, fontWeight: 600 }}>Planning an event?</strong>
              <span style={{ fontSize: 15, opacity: 0.9 }}>Tell us the date. We’ll reply with availability and a proposal you can sign online.</span>
            </span>
            <Link href={`/inquire/${inquireSlug}`} style={{ minHeight: 48, padding: '0 22px', borderRadius: radius.sm, background: color.onPrimary, color: color.primary, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', fontFamily: fonts.label, fontWeight: 600, fontSize: 15 }}>
              Check availability
            </Link>
          </section>
        ) : null}
        <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 30, fontWeight: 600, textAlign: 'center' }}>Sign in</h1>
        {signedOut === 'everywhere' ? (
          <p role="status" style={{ margin: 0, padding: '10px 14px', borderRadius: radius.sm, background: color.positiveBg, color: color.positiveStrong }}>You’re signed out on every device.</p>
        ) : null}
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 16 }}>
          {order.map((p) => (
            <section key={p} style={{ ...card(radius.xxl), padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: color.label }}>{PORTALS[p].who}</span>
              <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 22, fontWeight: 600 }}>{PORTALS[p].title}</h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: color.textMuted, flex: 1 }}>{PORTALS[p].blurb}</p>
              <Link href={`/login/${p}`} style={{ height: 46, borderRadius: radius.sm, background: p === 'admin' ? color.label : color.primary, color: color.onPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontFamily: fonts.label, fontWeight: 600, fontSize: 15 }}>
                Sign in
              </Link>
              {PORTALS[p].signup ? (
                <Link href={`/signup/${p}`} style={{ fontSize: 14, textAlign: 'center', color: color.label }}>
                  {p === 'contractor' ? 'New here? Apply to join the crew' : 'New client? Create an account'}
                </Link>
              ) : (
                <span style={{ fontSize: 13, textAlign: 'center', color: color.textMuted }}>Admin accounts are by invitation.</span>
              )}
            </section>
          ))}
        </div>
        {demoEnabled() ? <DemoPanel unavailable={demo === 'unavailable'} /> : null}
        <footer style={{ fontSize: 14, color: color.textMuted, display: 'flex', gap: 16 }}>
          <Link href="/privacy" style={{ color: color.label, minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Privacy policy</Link>
        </footer>
      </div>
    </main>
  );
}
