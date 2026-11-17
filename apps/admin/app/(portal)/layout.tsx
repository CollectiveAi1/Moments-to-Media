import type { ReactNode } from 'react';
import { PortalNav } from '@/components/portal/PortalNav';
import { Monogram } from '@/components/contractor/bits';
import { requireClient } from '@/lib/context';
import { color, fonts } from '@/lib/ui';

/**
 * The client portal. A client sees only their own projects, invoices,
 * released media and messages: row-level security keys every query to the
 * client records their login is attached to (app.is_client_of).
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const viewer = await requireClient();
  return (
    <div style={{ minHeight: '100vh', background: color.bg }}>
      <header style={{ background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Monogram size={40} />
          <span style={{ fontFamily: fonts.heading, fontSize: 17, fontWeight: 600 }}>{viewer.org.name}</span>
          <PortalNav />
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: color.textMuted, overflowWrap: 'anywhere' }}>{viewer.email}</span>
            <form action="/auth/sign-out" method="post">
              <button type="submit" style={{ minHeight: 40, padding: '0 12px', borderRadius: 8, border: `1px solid ${color.border}`, background: 'transparent', fontFamily: fonts.label, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Sign out
              </button>
            </form>
          </span>
        </div>
      </header>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</main>
    </div>
  );
}
