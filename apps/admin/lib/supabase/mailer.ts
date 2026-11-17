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
export async function sendSignInLink(email: string) {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  const client = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${proto}://${host}/auth/callback`, shouldCreateUser: true },
  });
}
