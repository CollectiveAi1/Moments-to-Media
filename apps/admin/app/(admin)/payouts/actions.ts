'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { fail, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';

const MOVES: Record<string, string> = {
  submitted: 'Submitted for approval.',
  approved: 'Approved.',
  sent: 'Recorded as sent.',
  paid: 'Recorded as paid. The contractor sees it in Earnings.',
  failed: 'Recorded as failed. Resubmit when it is fixed.',
};

/**
 * Producer submits, owner approves (or the organization's threshold does on
 * submit). Sent and paid are normally Stripe's to report; until Stripe Connect
 * is connected the owner records them by hand, which the state machine allows
 * the owner and nobody else.
 */
export async function movePayout(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const id = text(form, 'payout_id');
  const to = text(form, 'to');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !to || !(to in MOVES)) return fail('Missing payout.');
  const { data, error } = await viewer.supabase
    .rpc('transition_payout', { p_payout_id: id, p_to: to, p_reason: text(form, 'reason') })
    .single();
  if (!error && to === 'submitted' && (data as { status?: string } | null)?.status === 'approved') {
    return settle(null, 'Submitted and approved automatically: it is under the organization’s threshold.');
  }
  return settle(error, MOVES[to] ?? 'Saved.');
}
