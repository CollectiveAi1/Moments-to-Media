import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { card, color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'Page not found', description: 'That page does not exist or has moved.', robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100vh', background: color.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...card(radius.xxl), maxWidth: 460, width: '100%', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Wordmark />
        <p style={{ margin: 0, fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: color.label }}>Error 404</p>
        <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 28, fontWeight: 600 }}>We can’t find that page</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textSecondary }}>
          The link may be old, or the page may have moved. If someone sent you a proposal link, ask them for a fresh one.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/" style={{ minHeight: 48, padding: '0 18px', borderRadius: radius.sm, background: color.primary, color: color.onPrimary, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', fontFamily: fonts.label, fontWeight: 600 }}>Go to sign in</Link>
          <Link href="/privacy" style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', color: color.label }}>Privacy policy</Link>
        </div>
      </div>
    </main>
  );
}
