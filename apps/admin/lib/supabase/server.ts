import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from '../env';

/**
 * A Supabase client that acts as the signed-in person. It carries the anon key
 * and their session cookie and nothing else, so every query it makes is
 * subject to row-level security. There is deliberately no service-role client
 * in this app.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes the
          // session on every request, so there is nothing lost here.
        }
      },
    },
  });
}
