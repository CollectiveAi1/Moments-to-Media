'use client';

import { createBrowserClient } from '@supabase/ssr';

/** The browser's view of the session: the same cookies the server reads. */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}
