import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { SmallLink } from '@/components/auth/AuthForm';
import { createClient } from '@/lib/supabase/server';
import { HashSession } from './HashSession';

export const metadata: Metadata = { title: 'Signing in' };

const NOTICES: Record<string, string> = {
  link: 'That link has expired or was already used. Sign in with your password, or ask for a new link.',
  device: 'That link was made for another browser. Sign in with your password, or ask for a new link.',
};

/**
 * Where emailed links land: confirming a new account, resetting a password,
 * or an invitation. The session arrives in the URL fragment and HashSession
 * turns it into a cookie. Sign-in itself is at /login/<portal>.
 */
export default async function LinkLanding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/');
  const { error } = await searchParams;
  return (
    <AuthCard title="Signing you in" footer={<SmallLink href="/">Go to sign in</SmallLink>}>
      {error ? <p role="alert" style={{ margin: 0, fontSize: 14 }}>{NOTICES[error] ?? NOTICES.link}</p> : null}
      <HashSession />
    </AuthCard>
  );
}
