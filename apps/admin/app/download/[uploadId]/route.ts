import { NextResponse, type NextRequest } from 'next/server';
import { supabaseUrl } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

/**
 * Sends the browser straight to a short-lived R2 link for one upload. The
 * footage-download function decides who may have it, using this person's own
 * token, so a producer reaches their events' footage and a contractor their
 * own, and nobody else's.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.redirect(`${request.nextUrl.origin}/sign-in`);

  const res = await fetch(`${supabaseUrl()}/functions/v1/footage-download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.url) {
    return new NextResponse(body?.error?.message ?? 'That file could not be downloaded.', {
      status: res.status === 404 ? 404 : 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.redirect(body.url);
}
