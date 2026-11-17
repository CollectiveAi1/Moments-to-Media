import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from './supabase/server';

export type Role = 'owner' | 'producer' | 'contractor' | 'client';

export interface OrgMembership {
  id: string;
  name: string;
  roles: Role[];
}

export interface Viewer {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  name: string;
  orgs: OrgMembership[];
  /** The organization the console is showing. */
  org: OrgMembership | null;
  isOwner: boolean;
  isAdmin: boolean;
  isContractor: boolean;
}

export const ORG_COOKIE = 'mtm_org';

/**
 * Who is signed in, which organizations they belong to and in what roles.
 * This decides what the interface offers them. It is not what protects the
 * data: every query below runs as this person and row-level security decides
 * what comes back.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const [{ data: memberships }, { data: orgRows }, { data: profile }] = await Promise.all([
    supabase.from('memberships').select('org_id, role').eq('user_id', user.id).eq('status', 'active'),
    supabase.from('organization_public').select('id, name'),
    supabase.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle(),
  ]);

  const names = new Map<string, string>((orgRows ?? []).map((o) => [String(o.id), String(o.name)]));
  const byOrg = new Map<string, Role[]>();
  for (const m of memberships ?? []) {
    const list = byOrg.get(String(m.org_id)) ?? [];
    list.push(m.role as Role);
    byOrg.set(String(m.org_id), list);
  }
  const orgs: OrgMembership[] = [...byOrg.entries()]
    .map(([id, roles]) => ({ id, name: names.get(id) ?? 'Organization', roles }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const isAdminIn = (o: OrgMembership) => o.roles.includes('owner') || o.roles.includes('producer');
  const org =
    orgs.find((o) => o.id === preferred) ?? orgs.find(isAdminIn) ?? orgs[0] ?? null;

  const roles = org?.roles ?? [];
  return {
    supabase,
    userId: user.id,
    email: user.email ?? '',
    name: (profile?.full_name as string | undefined) ?? user.email ?? '',
    orgs,
    org,
    isOwner: roles.includes('owner'),
    isAdmin: roles.includes('owner') || roles.includes('producer'),
    isContractor: roles.includes('contractor'),
  };
});

/** For admin pages: anyone else is sent where they belong. */
export async function requireAdmin(): Promise<Viewer & { org: OrgMembership }> {
  const viewer = await getViewer();
  if (!viewer.org || !viewer.isAdmin) redirect(viewer.isContractor ? '/app' : '/no-access');
  return viewer as Viewer & { org: OrgMembership };
}

/** For contractor pages. An owner who also works shifts holds both roles. */
export async function requireContractor(): Promise<Viewer & { org: OrgMembership }> {
  const viewer = await getViewer();
  if (!viewer.org || !viewer.isContractor) redirect(viewer.isAdmin ? '/board' : '/no-access');
  return viewer as Viewer & { org: OrgMembership };
}
