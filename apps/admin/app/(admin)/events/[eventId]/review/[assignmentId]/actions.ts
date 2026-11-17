'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { fail, failWith, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';

const UUID = /^[0-9a-f-]{36}$/i;

async function deliverablesOf(assignmentId: string) {
  const viewer = await requireAdmin();
  const { data: a } = await viewer.supabase.from('assignments').select('id, org_id, slot_id').eq('id', assignmentId).maybeSingle();
  if (!a) return { viewer, assignment: null, deliverables: [] as Array<{ id: string }> };
  const { data: deliverables } = await viewer.supabase.from('deliverables').select('id').eq('slot_id', a.slot_id);
  return { viewer, assignment: a, deliverables: deliverables ?? [] };
}

/**
 * Approving records an approval for every deliverable on the slot (reviews are
 * append-only history), then moves the assignment. The state machine refuses
 * the move unless every deliverable's latest review is an approval, and on
 * approval it queues the payout.
 */
export async function approveAll(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const assignmentId = text(form, 'assignment_id');
  if (!assignmentId || !UUID.test(assignmentId)) return fail('Missing assignment.');
  const { viewer, assignment, deliverables } = await deliverablesOf(assignmentId);
  if (!assignment) return fail('That assignment was not found.');

  if (deliverables.length) {
    const { error } = await viewer.supabase.from('deliverable_reviews').insert(
      deliverables.map((d) => ({
        org_id: assignment.org_id,
        deliverable_id: d.id,
        assignment_id: assignmentId,
        decision: 'approved',
        notes: text(form, 'notes'),
        reviewer_id: viewer.userId,
      })),
    );
    if (error) return failWith(error);
  }

  const { error } = await viewer.supabase.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'approved' });
  return settle(
    error,
    `Approved. A payout is queued as a draft on Payouts${viewer.isOwner ? '' : ' for the owner to approve'}, and ${text(form, 'first_name') ?? 'the contractor'} can see it in Earnings.`,
  );
}

export async function requestChanges(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const assignmentId = text(form, 'assignment_id');
  const notes = text(form, 'notes');
  if (!assignmentId || !UUID.test(assignmentId)) return fail('Missing assignment.');
  if (!notes) return fail('Say what needs to change, so the contractor knows what to fix.');
  const { viewer, assignment, deliverables } = await deliverablesOf(assignmentId);
  if (!assignment) return fail('That assignment was not found.');

  const only = text(form, 'deliverable_id');
  const targets = only && UUID.test(only) ? deliverables.filter((d) => d.id === only) : deliverables;
  if (targets.length) {
    const { error } = await viewer.supabase.from('deliverable_reviews').insert(
      targets.map((d) => ({
        org_id: assignment.org_id,
        deliverable_id: d.id,
        assignment_id: assignmentId,
        decision: 'changes_requested',
        notes,
        reviewer_id: viewer.userId,
      })),
    );
    if (error) return failWith(error);
  }

  const { error } = await viewer.supabase.rpc('transition_assignment', {
    p_assignment_id: assignmentId,
    p_to: 'changes_requested',
    // With no deliverables there is no review row to carry the request, so it
    // rides on the assignment itself.
    p_note: targets.length ? null : notes,
  });
  return settle(error, `Changes requested. ${text(form, 'first_name') ?? 'The contractor'} sees your note and re-uploads.`);
}

export async function saveRating(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const assignmentId = text(form, 'assignment_id');
  if (!assignmentId || !UUID.test(assignmentId)) return fail('Missing assignment.');
  const score = (name: string) => {
    const n = Number(text(form, name));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const quality = score('quality');
  const punctuality = score('punctuality');
  const communication = score('communication');
  if (!quality || !punctuality || !communication) return fail('Rate all three, from 1 to 5.');

  const { data: existing } = await viewer.supabase.from('ratings').select('id').eq('assignment_id', assignmentId).maybeSingle();
  const { error } = existing
    ? await viewer.supabase.from('ratings').update({ quality, punctuality, communication, notes: text(form, 'notes') }).eq('id', existing.id)
    : await viewer.supabase.from('ratings').insert({
        org_id: viewer.org.id,
        assignment_id: assignmentId,
        quality,
        punctuality,
        communication,
        notes: text(form, 'notes'),
        rater_id: viewer.userId,
      });
  return settle(error, 'Rating saved. Contractors never see ratings.');
}
