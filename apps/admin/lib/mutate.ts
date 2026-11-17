import 'server-only';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from './action-types';
import { failWith, ok } from './errors';

/**
 * Every mutation ends the same way: report the database's answer in words and
 * refresh what the person can see. Revalidating the whole tree is blunt but
 * correct here, because one transition can move an event, a slot and the
 * board at once.
 */
export function settle(error: { message?: string; code?: string; hint?: string | null } | null, success: string): ActionResult {
  if (error) return failWith(error);
  revalidatePath('/', 'layout');
  return ok(success);
}
