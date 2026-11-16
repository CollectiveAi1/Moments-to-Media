import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { adminOrganizations } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';
import { card, color, fonts, radius } from '@/lib/ui';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const orgs = await adminOrganizations(supabase, user.id);

  if (orgs.length === 0) {
    // Signed in, but not an owner or producer anywhere. The database would
    // return nothing to them anyway; this says why instead of an empty board.
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ ...card(radius.xxl), maxWidth: 440, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 26, fontWeight: 600 }}>No admin access</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>
            {user.email} is signed in but is not an owner or producer of any organization. Ask an owner to
            invite this address, then sign in again.
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              style={{
                minHeight: 44,
                padding: '0 16px',
                borderRadius: radius.sm,
                border: `1px solid ${color.border}`,
                background: 'transparent',
                color: color.text,
                fontFamily: fonts.label,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <AppShell current="/board" email={user.email ?? ''}>
      {children}
    </AppShell>
  );
}
