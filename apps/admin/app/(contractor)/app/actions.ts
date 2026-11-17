'use server';

import type { ActionResult } from '@/lib/action-types';
import { requireContractor } from '@/lib/context';
import { cents, fail, failWith, int, ok, text } from '@/lib/errors';
import { settle, succeed } from '@/lib/mutate';

const UUID = /^[0-9a-f-]{36}$/i;
const idOf = (form: FormData, name: string) => {
  const v = text(form, name);
  return v && UUID.test(v) ? v : null;
};

async function transition(form: FormData, to: string, success: string): Promise<ActionResult> {
  const viewer = await requireContractor();
  const id = idOf(form, 'assignment_id');
  if (!id) return fail('Missing job.');
  const { error } = await viewer.supabase.rpc('transition_assignment', { p_assignment_id: id, p_to: to });
  return settle(error, success);
}

// ------------------------------------------------------------ respond

export async function confirmJob(_p: ActionResult, form: FormData) {
  return transition(form, 'confirmed', `Confirmed${text(form, 'event') ? `: ${text(form, 'event')}` : ''}. The packet is unlocked.`);
}

export async function declineInvite(_p: ActionResult, form: FormData) {
  return transition(form, 'declined', 'Declined. The producer has been told so they can pick the next candidate.');
}

export async function optIn(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const slotId = idOf(form, 'slot_id');
  if (!slotId) return fail('Missing job.');
  const { error } = await viewer.supabase.from('assignments').insert({
    org_id: text(form, 'org_id'),
    slot_id: slotId,
    user_id: viewer.userId,
    status: 'interested',
    note: text(form, 'note'),
  });
  if (error?.code === '42501') return fail('This job is no longer open to you: the call may have closed, or it needs gear or documents you have not added.');
  return settle(error, 'Interest sent. Nothing is booked until you confirm.');
}

export async function withdrawInterest(_p: ActionResult, form: FormData) {
  return transition(form, 'withdrawn', 'Interest withdrawn.');
}

// ----------------------------------------------------------- event day

export async function checkIn(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const id = idOf(form, 'assignment_id');
  if (!id) return fail('Missing job.');
  const lat = text(form, 'latitude');
  const lng = text(form, 'longitude');
  const { data, error } = await viewer.supabase.rpc('check_in', {
    p_assignment: id,
    p_latitude: lat === null ? null : Number(lat),
    p_longitude: lng === null ? null : Number(lng),
  });
  if (error) return failWith(error);
  const r = (data ?? {}) as { outside_radius?: boolean; distance_m?: number };
  return settle(
    null,
    r.outside_radius
      ? `Checked in. You are about ${r.distance_m} m from the venue, so the producer has been told.`
      : lat === null
        ? 'Checked in. Your location was not shared.'
        : 'Checked in.',
  );
}

export async function runningLate(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const id = idOf(form, 'assignment_id');
  const minutes = int(form, 'minutes');
  if (!id) return fail('Missing job.');
  if (!minutes || minutes < 1 || minutes > 600) return fail('Give your ETA in minutes.');
  const { data, error } = await viewer.supabase.rpc('report_running_late', { p_assignment: id, p_minutes: minutes });
  if (error) return failWith(error);
  const r = (data ?? {}) as { producer_name?: string };
  return succeed(`ETA of ${minutes} minutes sent to ${r.producer_name ?? 'the producer'} (producer).`);
}

export async function setShot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const assignmentId = idOf(form, 'assignment_id');
  const shotId = idOf(form, 'shot_id');
  const outcome = text(form, 'outcome');
  if (!assignmentId || !shotId || !outcome) return fail('Missing shot.');

  if (outcome === 'clear') {
    const { error } = await viewer.supabase.from('shot_checks').delete().eq('assignment_id', assignmentId).eq('shot_list_item_id', shotId);
    return settle(error, 'Unchecked.');
  }
  if (!['captured', 'not_possible'].includes(outcome)) return fail('Unknown outcome.');
  const reason = text(form, 'reason');
  if (outcome === 'not_possible' && !reason) return fail('Say why it was not possible.');

  // Not an upsert: only outcome, reason and photo are updatable.
  const fields = { outcome, reason: outcome === 'not_possible' ? reason : null };
  const { data: existing } = await viewer.supabase
    .from('shot_checks')
    .select('id')
    .eq('assignment_id', assignmentId)
    .eq('shot_list_item_id', shotId)
    .maybeSingle();
  const { error } = existing
    ? await viewer.supabase.from('shot_checks').update(fields).eq('id', existing.id)
    : await viewer.supabase.from('shot_checks').insert({ ...fields, org_id: text(form, 'org_id'), shot_list_item_id: shotId, assignment_id: assignmentId });
  if (error?.code === '42501') return fail('The shot list opens when you check in, and closes once you have checked out and moved on.');
  return settle(error, outcome === 'captured' ? 'Captured.' : 'Marked not possible.');
}

export async function checkOut(_p: ActionResult, form: FormData) {
  return transition(form, 'checked_out', 'Checked out. Upload your footage next.');
}

export async function markUploaded(_p: ActionResult, form: FormData) {
  return transition(form, 'uploaded', 'Upload marked complete. The producer has it for review.');
}

// ------------------------------------------------------------- profile

export async function saveProfile(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const name = text(form, 'full_name');
  if (!name) return fail('Your name is needed.');
  const { error } = await viewer.supabase
    .from('profiles')
    .update({ full_name: name, phone: text(form, 'phone'), bio: text(form, 'bio') })
    .eq('user_id', viewer.userId);
  return settle(error, 'Saved.');
}

export async function saveDetails(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const lat = text(form, 'latitude');
  const lng = text(form, 'longitude');
  if ((lat === null) !== (lng === null)) return fail('Give both latitude and longitude, or neither.');
  const radius = int(form, 'travel_radius_miles');
  if (radius !== null && (radius < 1 || radius > 1000)) return fail('Travel radius must be between 1 and 1000 miles.');
  const values = {
    skills: (text(form, 'skills') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    home_base_label: text(form, 'home_base_label'),
    home_base_latitude: lat === null ? null : Number(lat),
    home_base_longitude: lng === null ? null : Number(lng),
    travel_radius_miles: radius,
    default_rate_cents: cents(form, 'default_rate'),
  };
  // Not an upsert: user_id is outside the update grant, and ON CONFLICT DO
  // UPDATE needs update rights on every column it writes.
  const { data: existing } = await viewer.supabase.from('contractor_details').select('user_id').eq('user_id', viewer.userId).maybeSingle();
  const { error } = existing
    ? await viewer.supabase.from('contractor_details').update(values).eq('user_id', viewer.userId)
    : await viewer.supabase.from('contractor_details').insert({ ...values, user_id: viewer.userId });
  return settle(error, 'Saved. Open calls are matched against your area, gear and documents.');
}

const GEAR = ['camera_body', 'lens', 'audio', 'lighting', 'drone', 'other'];

export async function addGear(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const category = text(form, 'category');
  if (!category || !GEAR.includes(category)) return fail('Choose a category.');
  const { error } = await viewer.supabase.from('equipment').insert({
    user_id: viewer.userId,
    category,
    make: text(form, 'make'),
    model: text(form, 'model'),
  });
  return settle(error, 'Gear added.');
}

export async function removeGear(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const id = idOf(form, 'equipment_id');
  if (!id) return fail('Missing gear.');
  const { error } = await viewer.supabase.from('equipment').delete().eq('id', id);
  return settle(error, 'Removed.');
}

/**
 * One tap on a calendar day flips it between available and unavailable. A
 * day with no row is "not said"; the first tap marks it unavailable, which is
 * the thing a producer most needs to know.
 */
export async function toggleDay(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const date = text(form, 'date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Missing date.');
  const db = viewer.supabase;
  const { data: rows } = await db
    .from('availability')
    .select('id, is_available, recurrence_days')
    .eq('user_id', viewer.userId)
    .eq('starts_on', date)
    .eq('ends_on', date);
  const row = (rows ?? []).find((r) => !r.recurrence_days || (r.recurrence_days as number[]).length === 0);
  if (!row) {
    const { error } = await db.from('availability').insert({ user_id: viewer.userId, starts_on: date, ends_on: date, is_available: false });
    return settle(error, `${date} marked unavailable.`);
  }
  if (!row.is_available) {
    const { error } = await db.from('availability').update({ is_available: true }).eq('id', row.id);
    return settle(error, `${date} marked available.`);
  }
  const { error } = await db.from('availability').delete().eq('id', row.id);
  return settle(error, `${date} cleared.`);
}

export async function addDocument(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireContractor();
  const docType = text(form, 'doc_type');
  if (!docType || !['contractor_agreement', 'insurance', 'w9'].includes(docType)) return fail('Choose the document.');
  const { error } = await viewer.supabase.from('compliance_documents').insert({
    org_id: viewer.org.id,
    user_id: viewer.userId,
    doc_type: docType,
    status: 'submitted',
    expires_on: text(form, 'expires_on'),
  });
  return settle(error, 'Submitted. A producer reviews it and you will see the status here.');
}
