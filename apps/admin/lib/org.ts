import 'server-only';
import type { Viewer } from './context';

export interface Person {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
}

/** Everyone active in the organization, with their names. Admin-only data. */
export async function orgPeople(viewer: Viewer, orgId: string): Promise<Person[]> {
  const { supabase } = viewer;
  const { data: members, error } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw new Error(`Could not load the organization's people: ${error.message}`);

  const roles = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = roles.get(String(m.user_id)) ?? [];
    list.push(String(m.role));
    roles.set(String(m.user_id), list);
  }
  if (roles.size === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, phone')
    .in('user_id', [...roles.keys()]);
  const byId = new Map((profiles ?? []).map((p) => [String(p.user_id), p]));

  return [...roles.entries()]
    .map(([userId, r]) => {
      const p = byId.get(userId);
      return {
        userId,
        name: (p?.full_name as string | undefined) ?? 'Unnamed',
        email: (p?.email as string | null | undefined) ?? null,
        phone: (p?.phone as string | null | undefined) ?? null,
        roles: r,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const isProducerish = (p: Person) => p.roles.includes('owner') || p.roles.includes('producer');
