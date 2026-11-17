import Link from 'next/link';
import type { ReactNode } from 'react';
import { Monogram } from '@/components/contractor/bits';
import { color, fonts } from '@/lib/ui';

/** The frame for pages a client opens without an account. */
export function PublicShell({ orgName, children, wide = false }: { orgName: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', background: color.bg, display: 'flex', justifyContent: 'center' }}>
      <main id="main" tabIndex={-1} style={{ width: '100%', maxWidth: wide ? 1080 : 680, padding: '32px 20px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Monogram size={48} />
          <span style={{ fontFamily: fonts.heading, fontSize: 18, fontWeight: 600 }}>{orgName}</span>
        </header>
        {children}
        <footer style={{ fontSize: 13, color: color.textMuted, textAlign: 'center', display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span>{orgName}</span>
          <Link href="/privacy" style={{ color: color.label, minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Privacy policy</Link>
        </footer>
      </main>
    </div>
  );
}
