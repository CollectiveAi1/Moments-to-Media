import 'server-only';
import type { Viewer } from '../context';

/** The client records this login belongs to, in the current organization. */
export async function myClientIds(viewer: Viewer & { org: { id: string } }): Promise<Array<{ id: string; name: string }>> {
  const { data } = await viewer.supabase
    .from('client_contacts')
    .select('client_id, clients!client_contacts_client_id_fkey(id, name)')
    .eq('user_id', viewer.userId)
    .eq('org_id', viewer.org.id);
  const seen = new Map<string, string>();
  for (const row of (data ?? []) as unknown as Array<{ client_id: string; clients: { id: string; name: string } | null }>) {
    if (row.clients) seen.set(row.clients.id, row.clients.name);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
