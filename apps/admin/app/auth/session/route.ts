import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Turns the tokens from an emailed link (they arrive in the URL fragment, so
 * only the browser sees them) into the httpOnly session cookie. Same-origin
 * only, so another site cannot sign a visitor in to an account of its choosing.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown } | null;
  if (typeof body?.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    return NextResponse.json({ error: 'tokens missing' }, { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error) return NextResponse.json({ error: 'that link has expired or was already used' }, { status: 401 });
  return new NextResponse(null, { status: 204 });
}
