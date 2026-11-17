import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { card, color, fonts, radius } from '@/lib/ui';

/** The frame every sign-in, sign-up and password page shares. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: color.bg }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...card(radius.xxl), padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Link href="/" aria-label="Moments to Media home"><Wordmark /></Link>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
            {subtitle ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: color.textMuted }}>{subtitle}</p> : null}
          </div>
          {children}
        </div>
        <div style={{ fontSize: 14, textAlign: 'center', color: color.textMuted, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          {footer}
          <Link href="/privacy" style={{ fontSize: 13, color: color.label, minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Privacy policy</Link>
        </div>
      </div>
    </main>
  );
}
