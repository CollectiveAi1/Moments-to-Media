'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export interface SignInState {
  status: 'idle' | 'sent' | 'error';
  message: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where the emailed link should land: this deployment, whatever its address. */
async function origin(): Promise<string> {
  const h = await headers();
  const fromHeader = h.get('origin');
  if (fromHeader) return fromHeader;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function sendSignInLink(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL.test(email)) {
    return { status: 'error', message: 'Enter the email address you were invited with.', email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/callback` },
  });

  if (error) {
    // Rate limits are the realistic failure here and worth saying plainly.
    const message =
      error.status === 429
        ? 'Too many sign-in emails were requested. Wait a minute and try again.'
        : `The sign-in email could not be sent: ${error.message}`;
    return { status: 'error', message, email };
  }

  // The same message whether or not the address is known, so this form cannot
  // be used to find out who has an account.
  return {
    status: 'sent',
    message: `If ${email} has been invited, a sign-in link is on its way. Open it on this device.`,
    email,
  };
}
