import type { ReactNode } from 'react';
import { TabBar } from '@/components/contractor/TabBar';
import { requireContractor } from '@/lib/context';
import { color } from '@/lib/ui';

/**
 * The contractor app, as a phone-width web view. The native Expo app remains
 * the plan for background uploads (CLAUDE.md, locked decisions); this lets a
 * contractor use everything else from any phone browser today.
 */
export default async function ContractorLayout({ children }: { children: ReactNode }) {
  await requireContractor();
  return (
    <div style={{ minHeight: '100vh', background: color.bg, display: 'flex', justifyContent: 'center' }}>
      <main
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '20px 20px 120px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {children}
      </main>
      <TabBar />
    </div>
  );
}
