import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from './lib/env';
import { portalForPath } from './lib/portals';

// The inquiry form and proposal links are opened by people with no account.
// They reach the database only through functions made for them (see
// supabase/migrations/20261118000100_client_side.sql).
// Sign-in, sign-up and password pages are open too, and so is "/", which is
// the portal chooser when signed out.
const PUBLIC_PATHS = ['/sign-in', '/auth/', '/inquire/', '/p/', '/login/', '/signup/', '/forgot', '/account/password'];

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
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser checks the token with the auth server; it is what refreshes it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === '/' || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));

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
