'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { fail, failWith } from '@/lib/errors';
import { readEventFields } from '../fields';

export async function createEvent(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const read = await readEventFields(viewer, viewer.org.id, form);
  if ('error' in read) return fail(read.error);

  // A producer may only create events they produce (events_insert_admin).
  const values = viewer.isOwner ? read.values : { ...read.values, producer_id: viewer.userId };

  const { data, error } = await viewer.supabase
    .from('events')
    .insert({ ...values, org_id: viewer.org.id, status: 'draft' })
    .select('id')
    .single();
  if (error) return failWith(error);
  redirect(`/events/${data.id}?created=1`);
}
