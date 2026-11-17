'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEMO_ACCOUNTS, DEMO_REFUSAL, demoEnabled, isDemoEmail } from '@/lib/demo';
import { isPortal, PORTALS, passwordProblem, type Portal } from '@/lib/portals';
import { sendPasswordReset, signUpWithPassword } from '@/lib/supabase/mailer';
import { createClient } from '@/lib/supabase/server';

export interface AuthState {
  status: 'idle' | 'error' | 'sent';
  message: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The visitor's IP as Vercel reports it, for the sign-in throttle. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0]?.trim() || 'unknown';
}

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** Which portals an account may open, from its active memberships. */
async function access(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('memberships').select('role, status').eq('user_id', userId);
  const active = (data ?? []).filter((m) => m.status === 'active').map((m) => String(m.role));
  return {
    admin: active.includes('owner') || active.includes('producer'),
    contractor: active.includes('contractor'),
    pendingContractor: (data ?? []).some((m) => m.role === 'contractor' && m.status === 'pending'),
    client: active.includes('client'),
  };
}

/**
 * Email and password sign-in for one portal. The account must hold that
 * portal's role; if it holds another, the message says which sign-in to use
 * instead and the session is not kept.
 */
export async function signIn(_p: AuthState, form: FormData): Promise<AuthState> {
  const portal = field(form, 'portal');
  const email = field(form, 'email').toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!isPortal(portal)) return { status: 'error', message: 'Choose a portal to sign in to.', email };
  if (!EMAIL.test(email) || !password) return { status: 'error', message: 'Enter your email and password.', email };

  const supabase = await createClient();
  const ip = await clientIp();
  const { data: wait } = await supabase.rpc('login_wait_seconds', { p_email: email, p_ip: ip });
  if (typeof wait === 'number' && wait > 0) {
    return { status: 'error', message: `Too many wrong passwords. Try again in ${minutes(wait)} minute${minutes(wait) === 1 ? '' : 's'}, or reset your password.`, email };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (/confirm/i.test(error?.message ?? '')) {
      return { status: 'error', message: 'Confirm your email first: open the link we sent when you signed up.', email };
    }
    if (error?.status === 429) return { status: 'error', message: 'Too many attempts from this network. Wait a few minutes and try again.', email };
    const { data: after } = await supabase.rpc('record_login_failure', { p_email: email, p_ip: ip });
    if (typeof after === 'number' && after > 0) {
      return { status: 'error', message: `Wrong email or password. Sign-in is paused for ${minutes(after)} minutes after too many tries; you can reset your password now.`, email };
    }
    return { status: 'error', message: 'Wrong email or password.', email };
  }
  await supabase.rpc('clear_login_failures', { p_email: email, p_ip: ip });

  // Invitations and client records made since their last visit.
  await supabase.rpc('claim_invitations');
  await supabase.rpc('attach_client_records');

  const can = await access(supabase, data.user.id);
  if (portal === 'contractor' && !can.contractor && can.pendingContractor) redirect('/pending');
  if (!can[portal as Portal]) {
    await supabase.auth.signOut();
    const other = (['admin', 'contractor', 'client'] as const).filter((p) => p !== portal && can[p]);
    return {
      status: 'error',
      message: other.length
        ? `This account isn’t set up for the ${PORTALS[portal as Portal].title.toLowerCase()}. Sign in through the ${other.map((p) => PORTALS[p].title.toLowerCase()).join(' or ')} instead.`
        : portal === 'admin'
          ? 'This account has no admin access. Ask an owner to invite you.'
          : 'This account has no access here yet.',
      email,
    };
  }
  redirect(PORTALS[portal as Portal].home);
}

export async function signUp(_p: AuthState, form: FormData): Promise<AuthState> {
  const portal = field(form, 'portal');
  const name = field(form, 'name');
  const email = field(form, 'email').toLowerCase();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  const org = field(form, 'org');
  if (portal !== 'contractor' && portal !== 'client') return { status: 'error', message: 'Sign-up is for crew and clients.', email };
  if (field(form, 'website')) return { status: 'error', message: 'Something went wrong. Try again.', email };
  if (!name) return { status: 'error', message: 'Enter your full name.', email };
  if (!EMAIL.test(email)) return { status: 'error', message: 'Enter a valid email address.', email };
  const problem = passwordProblem(password, confirm);
  if (problem) return { status: 'error', message: problem, email };
  if (!/^[0-9a-f-]{36}$/i.test(org)) return { status: 'error', message: 'Choose who you work with.', email };
  if (form.get('terms') !== 'on') return { status: 'error', message: 'Tick the box to agree to the terms.', email };

  const { error } = await signUpWithPassword(email, password, { full_name: name, signup_role: portal, signup_org: org });
  if (error) {
    return {
      status: 'error',
      message: error.status === 429 ? 'Too many sign-up emails were sent recently. Try again in an hour.' : `Your account could not be created: ${error.message}`,
      email,
    };
  }
  // The same answer whether or not the address already has an account, so
  // the form cannot be used to find out who does.
  return {
    status: 'sent',
    message: `Check ${email} for a link to confirm your address. ${portal === 'contractor' ? 'After that, your application goes to the team for approval.' : 'After that, sign in to see your bookings.'} Already have an account? Use “Forgot password” instead.`,
    email,
  };
}

export async function forgotPassword(_p: AuthState, form: FormData): Promise<AuthState> {
  const email = field(form, 'email').toLowerCase();
  if (!EMAIL.test(email)) return { status: 'error', message: 'Enter the email you sign in with.', email };
  const { error } = await sendPasswordReset(email);
  if (error?.status === 429) return { status: 'error', message: 'Too many emails were sent recently. Try again in an hour.', email };
  return { status: 'sent', message: `If ${email} has an account, a link to set a new password is on its way.`, email };
}

export async function setPassword(_p: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get('password') ?? '');
  const problem = passwordProblem(password, String(form.get('confirm') ?? ''));
  if (problem) return { status: 'error', message: problem, email: '' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'error', message: 'Your link has expired. Ask for a new one.', email: '' };
  if (isDemoEmail(user.email)) return { status: 'error', message: DEMO_REFUSAL, email: '' };
  const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
  if (error) return { status: 'error', message: /different/i.test(error.message) ? 'Choose a password you have not used here before.' : `Could not save it: ${error.message}`, email: '' };
  redirect('/');
}

/** Demo mode only: sign in to a portal as its fictional demo account. */
export async function demoSignIn(form: FormData): Promise<void> {
  const portal = field(form, 'portal');
  if (!demoEnabled() || !isPortal(portal)) redirect('/');
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_ACCOUNTS[portal].email, password: process.env.DEMO_PASSWORD ?? '' });
  if (error) redirect(`/?demo=unavailable`);
  redirect(PORTALS[portal].home);
}

/** Ends every session this account has, on every device, then signs out here. */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/?signed_out=everywhere');
}
