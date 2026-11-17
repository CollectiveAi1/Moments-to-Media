/**
 * The three portals, each with its own sign-in page and home. One account can
 * hold several roles (an owner who also shoots); each portal only lets in the
 * role it is for.
 */
export type Portal = 'admin' | 'contractor' | 'client';

export const PORTALS: Record<Portal, {
  title: string;
  who: string;
  blurb: string;
  home: string;
  signup: boolean;
}> = {
  admin: {
    title: 'Admin console',
    who: 'Owners and producers',
    blurb: 'Run the board, staff events, review footage, bill clients and pay crew.',
    home: '/board',
    signup: false,
  },
  contractor: {
    title: 'Crew',
    who: 'Photographers, videographers and drone operators',
    blurb: 'Find jobs, get your event packet, check in, upload footage and see your pay.',
    home: '/app',
    signup: true,
  },
  client: {
    title: 'Client portal',
    who: 'Clients',
    blurb: 'See your bookings, sign and pay invoices, and download your photos and video.',
    home: '/portal',
    signup: true,
  },
};

export const isPortal = (v: string | undefined | null): v is Portal => v === 'admin' || v === 'contractor' || v === 'client';

/** Which sign-in a signed-out visitor to a path needs. */
export function portalForPath(path: string): Portal {
  if (path === '/app' || path.startsWith('/app/') || path === '/pending') return 'contractor';
  if (path === '/portal' || path.startsWith('/portal/')) return 'client';
  return 'admin';
}

/** Password rules, shared by sign-up and reset. */
export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use at least one letter and one number.';
  if (confirm !== undefined && confirm !== password) return 'The two passwords do not match.';
  return null;
}
