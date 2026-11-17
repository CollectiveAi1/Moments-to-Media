'use server';

import { sendSignInLink } from '@/lib/supabase/mailer';

export interface SignInState {
  status: 'idle' | 'sent' | 'error';
  message: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendSignInLinkAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL.test(email)) {
    return { status: 'error', message: 'Enter the email address you were invited with.', email };
  }

  const { error } = await sendSignInLink(email);

  if (error) {
    // The mailer allows only so many emails an hour for the whole project.
    const message =
      error.status === 429
        ? 'Too many sign-in emails were sent recently. Wait a while (up to an hour) and try once more.'
        : `The sign-in email could not be sent: ${error.message}`;
    return { status: 'error', message, email };
  }

  // The same message whether or not the address is known, so this form cannot
  // be used to find out who has an account.
  return {
    status: 'sent',
    message: `If ${email} has been invited, a sign-in link is on its way. It works on any device.`,
    email,
  };
}
