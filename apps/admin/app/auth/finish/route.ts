import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * After a session is set from an emailed link. An account that existed before
 * it was invited never passes through the database trigger that claims
 * invitations on first verification, so claim here; it is a no-op otherwise.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${request.nextUrl.origin}/sign-in?error=link`);

  const { error } = await supabase.rpc('claim_invitations');
  if (error) console.error('claim_invitations failed:', error.message);
  return NextResponse.redirect(`${request.nextUrl.origin}/`);
}
