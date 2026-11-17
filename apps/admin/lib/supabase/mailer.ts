import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from '../env';

/**
 * Sends a sign-in link to an address, from the server, without touching the
 * session of whoever is calling.
 *
 * This uses the implicit flow on purpose. The PKCE flow ties the link to the
 * browser that asked for it, which is wrong for an invitation (the producer
 * asks, the contractor opens it on their phone) and was a real stumbling
 * block for sign-in too. With the implicit flow the session arrives in the
 * link's URL fragment, which never reaches a server, and the sign-in page
 * picks it up in whichever browser opens it.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function implicitClient() {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function sendSignInLink(email: string) {
  return implicitClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback`, shouldCreateUser: true },
  });
}

/**
 * A new account with a password. Supabase emails a confirmation link; until
 * it is opened the account cannot sign in, and the database grants nothing
 * (app.apply_signup runs on confirmation).
 */
export async function signUpWithPassword(email: string, password: string, data: Record<string, string>) {
  return implicitClient().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback`, data },
  });
}

/** A link to choose a new password. Lands on /sign-in, which sends it to /account/password. */
export async function sendPasswordReset(email: string) {
  return implicitClient().auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/auth/callback` });
}
