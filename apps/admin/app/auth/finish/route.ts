import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * After a session is set from an emailed link. Claims any invitation, then
 * sends the person on:
 *   - a password-reset link, or an invitation or old sign-in link for an
 *     account that has never chosen a password: to /account/password;
 *   - anything else (a confirmed sign-up): home, which routes by role.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/sign-in?error=link`);

  const claimed = await supabase.rpc('claim_invitations');
  if (claimed.error) console.error('claim_invitations failed:', claimed.error.message);
  const attached = await supabase.rpc('attach_client_records');
  if (attached.error) console.error('attach_client_records failed:', attached.error.message);

  const type = request.nextUrl.searchParams.get('type') ?? '';
  const hasPassword = user.user_metadata?.password_set === true || user.user_metadata?.signup_role !== undefined;
  if (type === 'recovery') return NextResponse.redirect(`${origin}/account/password`);
  if (!hasPassword && (type === 'invite' || type === 'magiclink' || type === '')) {
    return NextResponse.redirect(`${origin}/account/password?first=1`);
  }
  return NextResponse.redirect(`${origin}/`);
}
