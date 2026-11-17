'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ORG_COOKIE } from '@/lib/context';

/** Which organization the console shows. Only a preference: RLS still decides. */
export async function switchOrg(form: FormData) {
  const org = String(form.get('org') ?? '');
  if (/^[0-9a-f-]{36}$/i.test(org)) {
    (await cookies()).set(ORG_COOKIE, org, { path: '/', sameSite: 'lax', httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/board');
}
