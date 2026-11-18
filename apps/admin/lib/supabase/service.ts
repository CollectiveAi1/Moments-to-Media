import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from '../env';

/**
 * The sign-in throttle (supabase/migrations/20261118000800, locked down in
 * 20261119000300). Its functions are callable only by the service role, so a
 * visitor cannot lock someone else out or clear their own count; this module
 * is the only caller, from the sign-in server action.
 *
 * The service-role key bypasses row-level security, so it is used for these
 * three calls and nothing else, never reaches the browser ('server-only'),
 * and lives only in Vercel's environment (CLAUDE.md rule 4).
 *
 * If the key is missing the throttle is skipped and logged rather than
 * failing every sign-in; Supabase Auth's own rate limits still apply.
 */
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.trim() === '') return null;
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

let warned = false;
function missing(): null {
  if (!warned) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set: the sign-in throttle is off.');
    warned = true;
  }
  return null;
}

/** Seconds until this email and IP may try again; 0 when allowed or unknown. */
export async function loginWaitSeconds(email: string, ip: string): Promise<number> {
  const db = serviceClient() ?? missing();
  if (!db) return 0;
  const { data, error } = await db.rpc('login_wait_seconds', { p_email: email, p_ip: ip });
  if (error) console.error('login_wait_seconds failed:', error.message);
  return typeof data === 'number' ? data : 0;
}

/** Records a wrong password; returns the wait now in force, if any. */
export async function recordLoginFailure(email: string, ip: string): Promise<number> {
  const db = serviceClient() ?? missing();
  if (!db) return 0;
  const { data, error } = await db.rpc('record_login_failure', { p_email: email, p_ip: ip });
  if (error) console.error('record_login_failure failed:', error.message);
  return typeof data === 'number' ? data : 0;
}

/** After a successful sign-in. */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const db = serviceClient() ?? missing();
  if (!db) return;
  const { error } = await db.rpc('clear_login_failures', { p_email: email, p_ip: ip });
  if (error) console.error('clear_login_failures failed:', error.message);
}
