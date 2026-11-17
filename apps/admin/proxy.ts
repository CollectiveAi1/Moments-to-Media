import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from './lib/env';
import { portalForPath } from './lib/portals';
import { AUTH_COOKIE_OPTIONS } from './lib/supabase/cookies';

// The signed-in areas. A signed-out visitor to one of these is sent to that
// portal's sign-in. Everything else (sign-in and sign-up, the inquiry form,
// proposal links, the privacy page, robots, sitemap, icons, and addresses
// that do not exist, which get the 404 page) renders without a session.
// This is a convenience: each page and every query checks access itself.
const PRIVATE_PREFIXES = ['/board', '/events', '/staffing', '/contractors', '/footage', '/payouts', '/leads', '/proposals', '/invoices', '/clients', '/packages', '/announcements', '/settings', '/app', '/portal', '/pending', '/account', '/download', '/no-access'];

/**
 * Runs before every page. Two jobs: keep the session cookie fresh, and send
 * anyone without a session to sign in. This is a convenience, not the
 * security boundary — a request that got past it without a session would
 * still read nothing, because the database decides that, not this file.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS });
      },
    },
  });

  // getUser checks the token with the auth server; it is what refreshes it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === '/account/password' || !PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = `/login/${portalForPath(pathname)}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
