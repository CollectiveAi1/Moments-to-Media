'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-types';
import { requireClient } from '@/lib/context';
import { supabaseUrl } from '@/lib/env';
import { fail, text } from '@/lib/errors';
import { settle } from '@/lib/mutate';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Starts a Stripe Checkout for what is due on an invoice. The client-checkout
 * Edge Function holds the Stripe key and works out the amount from the
 * invoice itself; the browser never says how much to charge.
 */
export async function payInvoice(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireClient();
  const invoiceId = text(form, 'invoice_id');
  const amount = text(form, 'amount') === 'balance' ? 'balance' : 'due';
  if (!invoiceId || !UUID.test(invoiceId)) return fail('That invoice was not found.');
  const {
    data: { session },
  } = await viewer.supabase.auth.getSession();
  if (!session) return fail('Sign in again to pay.');

  const res = await fetch(`${supabaseUrl()}/functions/v1/client-checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ invoice_id: invoiceId, amount, return_url: text(form, 'return_url') }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.url) return fail(body?.error?.message ?? 'Card payment could not be started. Try again, or contact us to pay another way.');
  redirect(body.url);
}

export async function sendMessage(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireClient();
  const clientId = text(form, 'client_id');
  const body = text(form, 'body');
  if (!clientId || !UUID.test(clientId)) return fail('Choose who the message is for.');
  if (!body) return fail('Write a message.');
  const { error } = await viewer.supabase.from('client_messages').insert({ org_id: viewer.org.id, client_id: clientId, author_id: viewer.userId, from_client: true, body });
  return settle(error, 'Message sent. We’ll reply here.');
}
