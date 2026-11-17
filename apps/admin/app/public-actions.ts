'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-types';
import { fail, failWith, text } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * Actions for people without an account: someone sending an inquiry, and a
 * client signing or declining a proposal from its private link. They call the
 * database functions anon is allowed (submit_inquiry, accept_proposal,
 * decline_proposal) and nothing else.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const TOKEN = /^[0-9a-f]{48,80}$/i;

export async function submitInquiry(_p: ActionResult, form: FormData): Promise<ActionResult> {
  // A field people never see. Bots fill it in.
  if (text(form, 'website')) return fail('Something went wrong. Try again.');
  const slug = text(form, 'slug') ?? '';
  const pkg = text(form, 'package_id');
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_inquiry', {
    p_org_slug: slug,
    p_name: text(form, 'name') ?? '',
    p_email: text(form, 'email'),
    p_phone: text(form, 'phone'),
    p_event_type: text(form, 'event_type'),
    p_event_date: text(form, 'event_date'),
    p_location: text(form, 'location'),
    p_package: pkg && UUID.test(pkg) ? pkg : null,
    p_message: text(form, 'message'),
  });
  if (error) return failWith(error);
  redirect(`/inquire/${encodeURIComponent(slug)}?sent=1`);
}

export async function acceptProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const token = text(form, 'token') ?? '';
  if (!TOKEN.test(token)) return fail('This proposal link is not valid.');
  if (form.get('agree') !== 'on') return fail('Tick the box to agree to the contract.');
  const signer = text(form, 'signer');
  const signature = text(form, 'signature');
  if (!signer) return fail('Enter your full name.');
  if (!signature) return fail('Type your name again to sign.');
  const addons = form.getAll('addon').map(String).filter((v) => UUID.test(v));
  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_proposal', { p_token: token, p_signer: signer, p_signature: signature, p_addons: addons });
  if (error) return failWith(error);
  redirect(`/p/${token}?signed=1`);
}

export async function declineProposal(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const token = text(form, 'token') ?? '';
  if (!TOKEN.test(token)) return fail('This proposal link is not valid.');
  const supabase = await createClient();
  const { error } = await supabase.rpc('decline_proposal', { p_token: token, p_reason: text(form, 'reason') });
  if (error) return failWith(error);
  redirect(`/p/${token}`);
}
