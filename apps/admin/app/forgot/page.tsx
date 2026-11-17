import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthForm, SmallLink, TextField } from '@/components/auth/AuthForm';
import { isPortal } from '@/lib/portals';
import { forgotPassword } from '../auth-actions';

export const metadata: Metadata = { title: 'Reset your password', description: 'Get a link to set a new password. It works once and expires after an hour.' };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ portal?: string }> }) {
  const { portal } = await searchParams;
  const back = isPortal(portal) ? `/login/${portal}` : '/';
  return (
    <AuthCard
      title="Reset your password"
      subtitle="We’ll email you a link to choose a new one. Accounts that signed in by email link before can set their first password this way too."
      footer={<SmallLink href={back}>Back to sign in</SmallLink>}
    >
      <AuthForm action={forgotPassword} submit="Email me a link">
        <TextField label="Email" name="email" type="email" autoComplete="email" />
      </AuthForm>
    </AuthCard>
  );
}
