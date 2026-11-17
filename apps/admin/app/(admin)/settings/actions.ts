'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { cents, fail, int, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';

const DOCS = ['contractor_agreement', 'insurance', 'w9'] as const;
const UUID = /^[0-9a-f-]{36}$/i;

export async function saveOrganization(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (!viewer.isOwner) return fail('Only an owner can change organization settings.');
  const name = text(form, 'name');
  if (!name) return fail('The organization needs a name.');

  const { data: current, error: readError } = await viewer.supabase.from('organizations').select('settings').eq('id', viewer.org.id).single();
  if (readError) return settle(readError, '');

  const invite = int(form, 'invite_window_hours');
  const confirm = int(form, 'confirm_deadline_hours');
  const retention = int(form, 'footage_retention_days');
  const threshold = cents(form, 'payout_auto_approve_under');
  if (!invite || invite < 1 || invite > 720) return fail('The invitation window must be between 1 and 720 hours.');
  if (!confirm || confirm < 1 || confirm > 168) return fail('The confirm deadline must be between 1 and 168 hours.');
  if (!retention || retention < 7) return fail('Keep footage for at least 7 days.');
  if (threshold === null) return fail('Give the auto-approval threshold in dollars (0 turns it off).');

  const reminders = (text(form, 'reminders') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const settings = {
    ...((current?.settings as Record<string, unknown>) ?? {}),
    invite_window_hours: invite,
    confirm_deadline_hours: confirm,
    footage_retention_days: retention,
    payout_auto_approve_under_cents: threshold,
    reminder_hours_before_call: reminders,
    required_compliance_documents: DOCS.filter((d) => form.get(`doc_${d}`) === 'on'),
  };
  const { error } = await viewer.supabase.from('organizations').update({ name, settings }).eq('id', viewer.org.id);
  return settle(error, 'Settings saved.');
}

export async function updateMember(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (!viewer.isOwner) return fail('Only an owner can change memberships.');
  const id = text(form, 'membership_id');
  const status = text(form, 'status');
  if (!id || !UUID.test(id) || !status || !['active', 'suspended'].includes(status)) return fail('Missing membership.');
  if (text(form, 'user_id') === viewer.userId && status === 'suspended') return fail('You cannot suspend yourself.');
  const { error } = await viewer.supabase.from('memberships').update({ status }).eq('id', id);
  return settle(error, status === 'suspended' ? 'Suspended. They lose access immediately.' : 'Reactivated.');
}

export async function removeMember(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (!viewer.isOwner) return fail('Only an owner can remove someone.');
  const id = text(form, 'membership_id');
  if (!id || !UUID.test(id)) return fail('Missing membership.');
  if (text(form, 'user_id') === viewer.userId && text(form, 'role') === 'owner') return fail('You cannot remove your own owner role.');
  const { error } = await viewer.supabase.from('memberships').delete().eq('id', id);
  return settle(error, 'Role removed.');
}
