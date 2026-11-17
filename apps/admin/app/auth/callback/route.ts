import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const OTP_TYPES: readonly string[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

/**
 * Where the emailed link lands. Supabase has already checked that the person
 * controls the address; this turns that into a session cookie. The first
 * verified sign-in is also when a pending invitation becomes a membership
 * (supabase/migrations/20261112000800), so nothing here grants access itself.
 */
/**
 * A new account claims its invitations when its email is first verified, in a
 * database trigger. Someone who already had an account when they were invited
 * never passes through that trigger, so their invitation is claimed here. The
 * function matches on the verified address and is a no-op when nothing is
 * pending; a failure is logged and does not block the sign-in.
 */
async function claimInvitations(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { error } = await supabase.rpc('claim_invitations');
  if (error) console.error('claim_invitations failed:', error.message);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createClient();

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await claimInvitations(supabase);
      return NextResponse.redirect(`${origin}/`);
    }
    // The code is bound to the browser that asked for it.
    const reason = /verifier/i.test(error.message) ? 'device' : 'link';
    return NextResponse.redirect(`${origin}/sign-in?error=${reason}`);
  }

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) {
      await claimInvitations(supabase);
      return NextResponse.redirect(`${origin}/`);
    }
  }

  // Links sent with the implicit flow land here with the session in the URL
  // fragment, which a server never sees. The fragment survives this redirect
  // and the sign-in page completes it in the browser.
  if (!code && !tokenHash) return NextResponse.redirect(`${origin}/sign-in`);
  return NextResponse.redirect(`${origin}/sign-in?error=link`);
}
