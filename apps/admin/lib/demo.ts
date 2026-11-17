import type { Portal } from './portals';

/**
 * Demo mode: one-click sign-in to each portal with a fictional account, so
 * Moments to Media can try every view before approving it. Temporary.
 *
 * It is on only when DEMO_MODE=on and DEMO_PASSWORD are set in the server's
 * environment (Vercel). To remove it: unset those variables, delete this file
 * and its callers (grep "demo"), and run supabase/demo/portal_demo_teardown.sql.
 */
export const DEMO_ACCOUNTS: Record<Portal, { email: string; who: string }> = {
  admin: { email: 'sam-park@demo.moments-to-media.invalid', who: 'Sam Park, producer' },
  contractor: { email: 'maya-chen@demo.moments-to-media.invalid', who: 'Maya Chen, photographer' },
  client: { email: 'demo-client@demo.moments-to-media.invalid', who: 'Avery Harper, wedding client' },
};

export function demoEnabled(): boolean {
  return process.env.DEMO_MODE === 'on' && Boolean(process.env.DEMO_PASSWORD);
}

export function isDemoEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').toLowerCase();
  return Object.values(DEMO_ACCOUNTS).some((a) => a.email === e);
}

export const DEMO_REFUSAL = 'Demo accounts can’t send emails or change sign-in details. Everything else works.';
