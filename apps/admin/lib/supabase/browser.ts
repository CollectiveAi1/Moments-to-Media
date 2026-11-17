'use client';

import { createClient } from '@supabase/supabase-js';

/** A short-lived access token from the server; null when signed out. */
export async function accessToken(): Promise<string | null> {
  const res = await fetch('/auth/token', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token: string | null }).access_token;
}

/** A Supabase client acting as the signed-in person, for this one token. */
export function tokenClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
