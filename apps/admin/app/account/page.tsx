import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { SmallLink } from '@/components/auth/AuthForm';
import { getViewer } from '@/lib/context';
import { isDemoEmail } from '@/lib/demo';
import { color, fonts, radius } from '@/lib/ui';
import { signOutEverywhere } from '../auth-actions';

export const metadata: Metadata = { title: 'Account and security', description: 'Change your password or sign out of every device.', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const viewer = await getViewer();
  const home = viewer.isAdmin ? '/board' : viewer.isContractor ? '/app' : viewer.orgs.some((o) => o.roles.includes('client')) ? '/portal' : '/';
  const demo = isDemoEmail(viewer.email);
  const button = { minHeight: 48, borderRadius: radius.sm, fontFamily: fonts.label, fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: '0 16px' } as const;
  return (
    <AuthCard title="Account and security" subtitle={`Signed in as ${viewer.email}.`} footer={<SmallLink href={home}>Back</SmallLink>}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Password</h2>
        <p style={{ margin: 0, fontSize: 14, color: color.textMuted }}>We’ll email you a link that works once and expires after an hour.</p>
        {demo ? (
          <p style={{ margin: 0, fontSize: 14 }}>Demo accounts can’t change their password.</p>
        ) : (
          <Link href="/forgot" style={{ ...button, border: `1px solid ${color.inputBorder}`, color: color.text }}>Change my password</Link>
        )}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Sign out of every device</h2>
        <p style={{ margin: 0, fontSize: 14, color: color.textMuted }}>
          Ends every session for this account: other phones, computers and browsers too. Use it if a device is lost or you signed in somewhere public.
        </p>
        <form action={signOutEverywhere}>
          <button type="submit" style={{ ...button, width: '100%', border: 0, background: color.primary, color: color.onPrimary }}>Sign out everywhere</button>
        </form>
      </section>
    </AuthCard>
  );
}
