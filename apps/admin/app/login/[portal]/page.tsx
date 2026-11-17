import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm, PasswordField, SmallLink, TextField } from '@/components/auth/AuthForm';
import { demoEnabled } from '@/lib/demo';
import { isPortal, PORTALS } from '@/lib/portals';
import { createClient } from '@/lib/supabase/server';
import { signIn } from '../../auth-actions';

export async function generateMetadata({ params }: { params: Promise<{ portal: string }> }): Promise<Metadata> {
  const { portal } = await params;
  const names: Record<string, string> = { admin: 'Admin console', contractor: 'Crew', client: 'Client portal' };
  const name = names[portal] ?? 'Moments to Media';
  return {
    title: `${name} sign-in`,
    description: `Sign in to the Moments to Media ${name.toLowerCase()} with your email and password.`,
  };
}
export const dynamic = 'force-dynamic';

export default async function LoginPage({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!isPortal(portal)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(PORTALS[portal].home);
  const p = PORTALS[portal];

  return (
    <AuthCard
      title={p.title}
      subtitle={`${p.who}: sign in with your email and password.`}
      footer={
        <>
          {p.signup ? <SmallLink href={`/signup/${portal}`}>{portal === 'contractor' ? 'New to the crew? Apply to join' : 'New client? Create an account'}</SmallLink> : null}
          {demoEnabled() ? <SmallLink href="/#demo">Just looking? Try the demo</SmallLink> : null}
          <SmallLink href="/">Not {portal === 'admin' ? 'an admin' : portal === 'client' ? 'a client' : 'crew'}? Choose another sign-in</SmallLink>
        </>
      }
    >
      <AuthForm action={signIn} submit="Sign in" hidden={{ portal }}>
        <TextField label="Email" name="email" type="email" autoComplete="email" />
        <PasswordField extra={<SmallLink href={`/forgot?portal=${portal}`}>Forgot password?</SmallLink>} />
      </AuthForm>
    </AuthCard>
  );
}
