'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { fail, failWith, ok, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';
import { sendSignInLink } from '@/lib/supabase/mailer';
import { revalidatePath } from 'next/cache';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * An invitation is a row the database matches to the address when that person
 * first signs in; the email is just a sign-in link. If the email cannot be
 * sent, the invitation still stands and they can sign in from the sign-in
 * page themselves.
 */
export async function inviteMember(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const email = text(form, 'email')?.toLowerCase();
  const role = text(form, 'role') ?? 'contractor';
  if (!email || !EMAIL.test(email)) return fail('Enter a valid email address.');
  if (!['contractor', 'producer', 'owner'].includes(role)) return fail('Choose a role.');
  if (role !== 'contractor' && !viewer.isOwner) return fail('Only an owner can invite producers and owners.');

  const { error } = await viewer.supabase.from('org_invitations').insert({
    org_id: viewer.org.id,
    role,
    email,
    invited_by: viewer.userId,
  });
  if (error) {
    return error.code === '23505' ? fail(`${email} already has a pending invitation.`) : failWith(error);
  }
  revalidatePath('/', 'layout');

  if (form.get('send') !== 'on') return ok(`${email} is invited as ${role}. They can sign in at any time with that address.`);
  const sent = await sendSignInLink(email);
  if (sent.error) {
    return ok(`${email} is invited as ${role}, but the email could not be sent (${sent.error.status === 429 ? 'the hourly email limit was reached' : sent.error.message}). They can sign in from the sign-in page with that address.`);
  }
  return ok(`${email} is invited as ${role} and has been sent a sign-in link.`);
}

export async function resendInvite(_p: ActionResult, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const email = text(form, 'email');
  if (!email) return fail('Missing address.');
  const sent = await sendSignInLink(email);
  if (sent.error) return fail(sent.error.status === 429 ? 'The hourly email limit was reached. Try again later.' : sent.error.message);
  return ok(`Sign-in link sent to ${email}.`);
}

export async function revokeInvite(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const id = text(form, 'invitation_id');
  if (!id || !UUID.test(id)) return fail('Missing invitation.');
  const { error } = await viewer.supabase.from('org_invitations').update({ status: 'revoked' }).eq('id', id);
  return settle(error, 'Invitation revoked.');
}

export async function reviewDocument(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const id = text(form, 'document_id');
  const status = text(form, 'status');
  if (!id || !UUID.test(id) || !status || !['approved', 'rejected'].includes(status)) return fail('Missing document.');
  const { error } = await viewer.supabase.from('compliance_documents').update({ status }).eq('id', id);
  return settle(error, status === 'approved' ? 'Document approved.' : 'Document rejected. They will see it needs replacing.');
}
