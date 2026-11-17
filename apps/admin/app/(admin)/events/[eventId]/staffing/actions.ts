'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { fail, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';

const UUID = /^[0-9a-f-]{36}$/i;
const idOf = (form: FormData, name: string) => {
  const v = text(form, name);
  return v && UUID.test(v) ? v : null;
};

/** Direct invite: the producer's choice already, so accepting it commits. */
export async function invite(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const slotId = idOf(form, 'slot_id');
  const userId = idOf(form, 'user_id');
  if (!slotId || !userId) return fail('Missing slot or contractor.');
  const { error } = await viewer.supabase.from('assignments').insert({
    org_id: viewer.org.id,
    slot_id: slotId,
    user_id: userId,
    status: 'invited',
    note: text(form, 'note'),
  });
  return settle(error, `${text(form, 'name') ?? 'They'} ${text(form, 'name') ? 'is' : 'are'} invited. The invitation expires per your settings.`);
}

async function move(form: FormData, to: string, success: (name: string) => string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const assignmentId = idOf(form, 'assignment_id');
  if (!assignmentId) return fail('Missing assignment.');
  const { error } = await viewer.supabase.rpc('transition_assignment', {
    p_assignment_id: assignmentId,
    p_to: to,
    p_note: text(form, 'note'),
  });
  return settle(error, success(text(form, 'name') ?? 'They'));
}

export async function select(_p: ActionResult, form: FormData) {
  return move(form, 'selected', (n) => `${n} selected. Confirm request sent; they have until the deadline to confirm. Everyone else hears the slot is filled once ${n.split(' ')[0]} confirms.`);
}

export async function pass(_p: ActionResult, form: FormData) {
  return move(form, 'not_selected', (n) => `${n} marked not selected.`);
}

export async function withdrawInvite(_p: ActionResult, form: FormData) {
  return move(form, 'expired', (n) => `Invitation to ${n} withdrawn.`);
}

export async function expireSelection(_p: ActionResult, form: FormData) {
  return move(form, 'expired', (n) => `${n}'s selection expired. The slot is open again.`);
}

export async function cancelBooking(_p: ActionResult, form: FormData) {
  return move(form, 'cancelled', (n) => `${n}'s booking is cancelled and the slot is open again.`);
}
