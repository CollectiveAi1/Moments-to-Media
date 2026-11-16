import type { ReactNode } from 'react';
import { color } from '@/lib/ui';
import { Sidebar } from './Sidebar';

/**
 * UI-SPEC section 3, `AppShell`: a wrapping row, so the sidebar sits beside
 * the page on a wide screen and stacks above it on a narrow one without a
 * breakpoint.
 */
export function AppShell({
  current,
  email,
  children,
}: {
  current: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: color.adminBg,
        color: color.text,
        display: 'flex',
        flexWrap: 'wrap',
      }}
    >
      <Sidebar current={current} email={email} />
      <main
        style={{
          flex: '999 1 560px',
          minWidth: 0,
          padding: '28px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {children}
      </main>
    </div>
  );
}
