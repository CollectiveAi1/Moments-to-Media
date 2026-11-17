import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/context';
import { card, color, fonts, radius } from '@/lib/ui';

export const metadata: Metadata = { title: 'No access', description: 'This account has no access to this part of Moments to Media.', robots: { index: false, follow: false } };

export default async function NoAccess() {
  const viewer = await getViewer();
  if (viewer.isAdmin) redirect('/board');
  if (viewer.isContractor) redirect('/app');
  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...card(radius.xxl), maxWidth: 440, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 26, fontWeight: 600 }}>No access yet</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: color.textBody }}>
          {viewer.email} is signed in but is not a member of any organization. Ask an owner to invite this
          address, then sign in again.
        </p>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            style={{ minHeight: 44, padding: '0 16px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: 'transparent', color: color.text, fontFamily: fonts.label, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
