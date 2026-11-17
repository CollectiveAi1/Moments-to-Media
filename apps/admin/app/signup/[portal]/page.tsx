import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm, PasswordField, SmallLink, TextField } from '@/components/auth/AuthForm';
import { createClient } from '@/lib/supabase/server';
import { color, fonts, radius } from '@/lib/ui';
import { signUp } from '../../auth-actions';

export async function generateMetadata({ params }: { params: Promise<{ portal: string }> }): Promise<Metadata> {
  const { portal } = await params;
  const names: Record<string, string> = { admin: 'Admin console', contractor: 'Crew', client: 'Client portal' };
  const name = names[portal] ?? 'Moments to Media';
  return {
    title: portal === 'contractor' ? 'Join the crew' : 'Create your client account',
    description: portal === 'contractor' ? 'Apply to shoot with Moments to Media: create an account and fill in your profile.' : 'Create your Moments to Media client account to see bookings, pay invoices and download your media.',
  };
}
export const dynamic = 'force-dynamic';

export default async function SignUpPage({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (portal !== 'contractor' && portal !== 'client') notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc('signup_orgs', { p_role: portal });
  const orgs = (data ?? []) as Array<{ id: string; name: string }>;
  const contractor = portal === 'contractor';

  return (
    <AuthCard
      title={contractor ? 'Join the crew' : 'Create your client account'}
      subtitle={
        contractor
          ? 'Create an account and fill in your profile. The team reviews new crew before you can see and take jobs.'
          : 'Use the email you booked with, and your bookings, invoices and media appear automatically.'
      }
      footer={<SmallLink href={`/login/${portal}`}>Already have an account? Sign in</SmallLink>}
    >
      {orgs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 15 }}>Sign-up is closed right now. Contact the team for an invitation.</p>
      ) : (
        <AuthForm action={signUp} submit={contractor ? 'Apply' : 'Create account'} hidden={orgs.length === 1 ? { portal, org: orgs[0]!.id } : { portal }}>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} />
          {orgs.length > 1 ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: color.textMuted }}>Company</span>
              <select name="org" required style={{ height: 48, borderRadius: radius.sm, border: `1px solid ${color.inputBorder}`, background: color.surface, padding: '0 10px', fontSize: 15 }}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ) : null}
          <TextField label="Full name" name="name" autoComplete="name" />
          <TextField label="Email" name="email" type="email" autoComplete="email" />
          <PasswordField autoComplete="new-password" hint="At least 10 characters, with a letter and a number." />
          <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45 }}>
            <input type="checkbox" name="terms" required style={{ width: 18, height: 18, marginTop: 2 }} />
            <span>I agree to {orgs.length === 1 ? orgs[0]!.name : 'the company'}’s terms, have read the <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: color.label }}>privacy policy</a>, and agree to receive emails about my {contractor ? 'jobs' : 'bookings'}.</span>
          </label>
        </AuthForm>
      )}
    </AuthCard>
  );
}
