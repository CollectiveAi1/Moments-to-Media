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

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * Signed out: choose a portal. Signed in: straight to the portal the account
 * belongs to (owners and producers to the board, crew to their app, clients
 * to their portal).
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
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
  const { demo } = await searchParams;
  return (
    <main style={{ minHeight: '100vh', background: color.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'center' }}>
        <Wordmark />
        <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 30, fontWeight: 600, textAlign: 'center' }}>Sign in</h1>
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
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
      </div>
    </main>
  );
}
