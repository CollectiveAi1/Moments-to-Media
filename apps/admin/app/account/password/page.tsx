import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm, PasswordField } from '@/components/auth/AuthForm';
import { createClient } from '@/lib/supabase/server';
import { setPassword } from '../../auth-actions';

export const metadata: Metadata = { title: 'Choose a password' };
export const dynamic = 'force-dynamic';

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/forgot');
  return (
    <AuthCard
      title={first ? 'Create your password' : 'Choose a new password'}
      subtitle={`For ${user.email}. From now on you sign in with your email and this password.`}
    >
      <AuthForm action={setPassword} submit="Save password">
        <PasswordField label="New password" autoComplete="new-password" hint="At least 10 characters, with a letter and a number." />
        <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" />
      </AuthForm>
    </AuthCard>
  );
}
