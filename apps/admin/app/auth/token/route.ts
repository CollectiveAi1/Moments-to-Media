import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * The current access token, for the one browser feature that calls Supabase
 * directly: the uploader, whose file parts go straight to storage. The token
 * lives about an hour; the refresh token stays in the httpOnly cookie.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const { data: { session } } = await supabase.auth.getSession();
  return NextResponse.json({ access_token: session?.access_token ?? null }, { headers: { 'cache-control': 'no-store' } });
}
