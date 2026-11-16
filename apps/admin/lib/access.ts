import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether the signed-in person runs any organization. This decides what the
 * console shows them, and only that: it is not what keeps a contractor out of
 * the data. Row-level security reads `memberships` itself on every query.
 */
export async function adminOrganizations(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role', ['owner', 'producer']);

  if (error) throw new Error(`Could not read your memberships: ${error.message}`);
  return [...new Set((data ?? []).map((m) => String(m.org_id)))];
}
