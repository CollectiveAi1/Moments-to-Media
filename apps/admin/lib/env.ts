/**
 * The two public Supabase values. Read through here so a missing one fails
 * with its name rather than as an opaque fetch error on the first query.
 */
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`${name} is not set. Copy apps/admin/.env.example to .env.local.`);
  }
  return value;
}

// Referenced literally: Next.js only inlines NEXT_PUBLIC_ values it can see
// spelled out, so these cannot be looked up by a computed key.
export const supabaseUrl = () =>
  required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = () =>
  required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
