import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

/** Signed-in pages are private: never in search results. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { requireAdmin } from '@/lib/context';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await requireAdmin();
  return (
    <AppShell email={viewer.email} orgs={viewer.orgs} orgId={viewer.org.id} isContractor={viewer.isContractor}>
      {children}
    </AppShell>
  );
}
