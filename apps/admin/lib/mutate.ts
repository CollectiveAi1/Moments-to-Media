import 'server-only';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { ActionResult } from './action-types';
import { failWith, ok } from './errors';

export const FLASH_COOKIE = 'mtm_flash';

/**
 * Success is announced at the top of the page, not beside the button. Many
 * actions remove their own button (Open staffing, Confirm, Submit payout),
 * so a message kept inside that form would vanish with it, exactly when the
 * person most wants to know it worked. The cookie lives a few seconds and is
 * read by the layout's FlashNotice; it also reaches a browser with
 * JavaScript off, because the layout renders it into the page.
 */
export async function succeed(message: string): Promise<ActionResult> {
  (await cookies()).set(FLASH_COOKIE, encodeURIComponent(message), { path: '/', maxAge: 15, sameSite: 'lax' });
  revalidatePath('/', 'layout');
  return ok(message);
}

/** Report the database's answer in words and refresh what the person can see. */
export async function settle(
  error: { message?: string; code?: string; hint?: string | null } | null,
  success: string,
): Promise<ActionResult> {
  if (error) return failWith(error);
  return succeed(success);
}
