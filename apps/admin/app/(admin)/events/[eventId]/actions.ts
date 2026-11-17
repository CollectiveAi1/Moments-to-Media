'use server';

import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-types';
import { requireAdmin } from '@/lib/context';
import { cents, fail, failWith, int, text } from '@/lib/errors';
import { zonedToUtc } from '@/lib/format';
import { settle } from '@/lib/mutate';
import { readEventFields } from '../fields';

const GEAR = ['camera_body', 'lens', 'audio', 'lighting', 'drone', 'other'] as const;
const UUID = /^[0-9a-f-]{36}$/i;

function id(form: FormData, name: string): string | null {
  const v = text(form, name);
  return v && UUID.test(v) ? v : null;
}

async function eventZone(eventId: string) {
  const viewer = await requireAdmin();
  const { data } = await viewer.supabase.from('events').select('time_zone, starts_at, status').eq('id', eventId).single();
  return { viewer, zone: String(data?.time_zone ?? 'UTC'), startsAt: String(data?.starts_at ?? ''), status: String(data?.status ?? '') };
}

// ------------------------------------------------------------------ event

export async function updateEvent(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  if (!eventId) return fail('Missing event.');
  const read = await readEventFields(viewer, viewer.org.id, form);
  if ('error' in read) return fail(read.error);
  const { error } = await viewer.supabase.from('events').update(read.values).eq('id', eventId);
  return settle(error, 'Event details saved.');
}

export async function moveEvent(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  const to = text(form, 'to');
  if (!eventId || !to) return fail('Missing event or status.');

  const { error } = await viewer.supabase.rpc('transition_event', {
    p_event_id: eventId,
    p_to: to,
    p_reason: text(form, 'reason'),
  });
  if (error) return failWith(error);

  // Opening staffing posts every drafted slot: open calls to the job board,
  // direct-invite slots ready for invitations.
  if (to === 'staffing') {
    const { data: slots } = await viewer.supabase
      .from('slots')
      .select('id, staffing_mode')
      .eq('event_id', eventId)
      .eq('status', 'draft');
    for (const s of slots ?? []) {
      await viewer.supabase
        .from('slots')
        .update({ status: s.staffing_mode === 'open_call' ? 'open_call' : 'inviting' })
        .eq('id', s.id);
    }
  }

  const words: Record<string, string> = {
    staffing: 'Staffing is open. Open calls are on the job board.',
    staffed: 'Marked staffed.',
    in_progress: 'The event is in progress.',
    uploaded: 'Marked uploaded.',
    complete: 'The event is complete.',
    cancelled: 'The event is cancelled. Confirmed crew were released and everyone who opted in was told.',
  };
  return settle(null, words[to] ?? 'Status changed.');
}

export async function deleteEvent(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  if (!eventId) return fail('Missing event.');
  const { error, count } = await viewer.supabase.from('events').delete({ count: 'exact' }).eq('id', eventId);
  if (error) return failWith(error);
  if (!count) return fail('Only a draft can be deleted. Cancel the event instead.');
  redirect('/events?show=draft');
}

// ------------------------------------------------------------------ brief

export async function saveBrief(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  if (!eventId) return fail('Missing event.');
  // Not an upsert: the update grant on briefs covers only the text columns, and
  // ON CONFLICT DO UPDATE needs update rights on every column it writes.
  const fields = { summary: text(form, 'summary'), body: text(form, 'body') };
  const { data: existing } = await viewer.supabase.from('briefs').select('id').eq('event_id', eventId).maybeSingle();
  const { error } = existing
    ? await viewer.supabase.from('briefs').update(fields).eq('id', existing.id)
    : await viewer.supabase.from('briefs').insert({ ...fields, org_id: viewer.org.id, event_id: eventId });
  return settle(error, 'Brief saved.');
}

// ------------------------------------------------------------------ slots

function slotValues(form: FormData, zone: string, fallbackStart: string) {
  const role = text(form, 'role');
  if (!role) return { error: 'Name the role, for example Lead video.' };
  const rateType = text(form, 'rate_type') ?? 'flat';
  if (!['flat', 'hourly', 'day'].includes(rateType)) return { error: 'Choose a rate type.' };
  const rate = cents(form, 'rate');
  if (rate === null) return { error: 'Give the rate in dollars.' };

  const callDate = text(form, 'call_date');
  const callTime = text(form, 'call_time');
  const call = callDate && callTime ? zonedToUtc(callDate, callTime, zone).toISOString() : fallbackStart;

  const deadlineDate = text(form, 'deadline_date');
  const deadline = deadlineDate ? zonedToUtc(deadlineDate, text(form, 'deadline_time') ?? '21:00', zone).toISOString() : null;

  const minimum = text(form, 'minimum_hours');
  const otAfter = text(form, 'overtime_after');
  const otMult = text(form, 'overtime_multiplier');
  const mode = text(form, 'staffing_mode') === 'open_call' ? 'open_call' : 'direct_invite';

  return {
    values: {
      role,
      rate_type: rateType,
      rate_amount_cents: rate,
      call_time: call,
      required_gear: GEAR.filter((g) => form.get(`gear_${g}`) === 'on'),
      staffing_mode: mode,
      interest_deadline: mode === 'open_call' ? deadline : null,
      is_required: form.get('is_required') === 'on',
      minimum_hours: rateType === 'hourly' && minimum ? Number(minimum) : null,
      overtime_rule:
        rateType === 'hourly' && otAfter ? { after_hours: Number(otAfter), multiplier: Number(otMult ?? 1.5) } : null,
    },
  };
}

export async function addSlot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const eventId = id(form, 'event_id');
  if (!eventId) return fail('Missing event.');
  const { viewer, zone, startsAt, status } = await eventZone(eventId);
  const read = slotValues(form, zone, startsAt);
  if ('error' in read) return fail(String(read.error));
  // A slot added once staffing is open goes straight out; before that it waits as a draft.
  const live = ['staffing', 'staffed'].includes(status);
  const slotStatus = live ? (read.values.staffing_mode === 'open_call' ? 'open_call' : 'inviting') : 'draft';
  const { error } = await viewer.supabase
    .from('slots')
    .insert({ ...read.values, org_id: viewer.org.id, event_id: eventId, status: slotStatus });
  return settle(error, `${read.values.role} slot added.`);
}

export async function updateSlot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const eventId = id(form, 'event_id');
  const slotId = id(form, 'slot_id');
  if (!eventId || !slotId) return fail('Missing slot.');
  const { viewer, zone, startsAt } = await eventZone(eventId);
  const read = slotValues(form, zone, startsAt);
  if ('error' in read) return fail(String(read.error));
  const { error } = await viewer.supabase.from('slots').update(read.values).eq('id', slotId);
  return settle(error, 'Slot saved.');
}

export async function setSlotStatus(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const slotId = id(form, 'slot_id');
  const to = text(form, 'to');
  if (!slotId || !to || !['open_call', 'inviting', 'draft', 'cancelled'].includes(to)) return fail('Missing slot.');
  const { error } = await viewer.supabase.from('slots').update({ status: to }).eq('id', slotId);
  const words: Record<string, string> = {
    open_call: 'Posted to the job board.',
    inviting: 'Ready for invitations.',
    draft: 'Taken off the job board.',
    cancelled: 'Slot cancelled.',
  };
  return settle(error, words[to] ?? 'Saved.');
}

export async function deleteSlot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const slotId = id(form, 'slot_id');
  if (!slotId) return fail('Missing slot.');
  const { data: crew } = await viewer.supabase.from('assignments').select('id').eq('slot_id', slotId).limit(1);
  if ((crew ?? []).length > 0) return fail('Someone has already been invited or opted in. Cancel the slot instead of deleting it.');
  const { error } = await viewer.supabase.from('slots').delete().eq('id', slotId);
  return settle(error, 'Slot deleted.');
}

// ------------------------------------------------------------ deliverables

export async function addDeliverable(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const eventId = id(form, 'event_id');
  const slotId = id(form, 'slot_id');
  if (!eventId || !slotId) return fail('Choose which slot owes this deliverable.');
  const { viewer, zone } = await eventZone(eventId);
  const title = text(form, 'title');
  if (!title) return fail('Name the deliverable, for example 40 edited stills.');
  const dueDate = text(form, 'due_date');
  const spec: Record<string, string | number> = {};
  const format = text(form, 'format');
  const count = int(form, 'count');
  if (format) spec.format = format;
  if (count) spec.count = count;
  const { error } = await viewer.supabase.from('deliverables').insert({
    org_id: viewer.org.id,
    slot_id: slotId,
    title,
    spec,
    due_at: dueDate ? zonedToUtc(dueDate, text(form, 'due_time') ?? '17:00', zone).toISOString() : null,
  });
  return settle(error, 'Deliverable added.');
}

export async function deleteDeliverable(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const deliverableId = id(form, 'deliverable_id');
  if (!deliverableId) return fail('Missing deliverable.');
  const { error } = await viewer.supabase.from('deliverables').delete().eq('id', deliverableId);
  return settle(error, 'Deliverable removed.');
}

// --------------------------------------------------------------- shot list

export async function addShot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  const title = text(form, 'title');
  if (!eventId) return fail('Missing event.');
  if (!title) return fail('Name the shot.');
  const { data: last } = await viewer.supabase
    .from('shot_list_items')
    .select('position')
    .eq('event_id', eventId)
    .order('position', { ascending: false })
    .limit(1);
  const { error } = await viewer.supabase.from('shot_list_items').insert({
    org_id: viewer.org.id,
    event_id: eventId,
    slot_id: id(form, 'slot_id'),
    title,
    description: text(form, 'description'),
    must_have: form.get('must_have') === 'on',
    position: Number(last?.[0]?.position ?? 0) + 1,
  });
  return settle(error, 'Shot added.');
}

export async function toggleMustHave(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const shotId = id(form, 'shot_id');
  if (!shotId) return fail('Missing shot.');
  const { error } = await viewer.supabase
    .from('shot_list_items')
    .update({ must_have: form.get('must_have') === 'true' })
    .eq('id', shotId);
  return settle(error, 'Shot updated.');
}

export async function deleteShot(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const shotId = id(form, 'shot_id');
  if (!shotId) return fail('Missing shot.');
  const { error } = await viewer.supabase.from('shot_list_items').delete().eq('id', shotId);
  return settle(error, 'Shot removed.');
}

// ---------------------------------------------------------------- contacts

export async function addContact(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const eventId = id(form, 'event_id');
  const name = text(form, 'name');
  const kind = text(form, 'kind') === 'emergency' ? 'emergency' : 'on_site';
  if (!eventId) return fail('Missing event.');
  if (!name) return fail('Give the contact a name.');
  const { error } = await viewer.supabase
    .from('event_contacts')
    .insert({ org_id: viewer.org.id, event_id: eventId, kind, name, phone: text(form, 'phone') });
  return settle(error, 'Contact added.');
}

export async function deleteContact(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const contactId = id(form, 'contact_id');
  if (!contactId) return fail('Missing contact.');
  const { error } = await viewer.supabase.from('event_contacts').delete().eq('id', contactId);
  return settle(error, 'Contact removed.');
}

export async function addClientContact(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const clientId = id(form, 'client_id');
  const name = text(form, 'name');
  if (!clientId) return fail('Set a client on the event first.');
  if (!name) return fail('Give the contact a name.');
  const { error } = await viewer.supabase.from('client_contacts').insert({
    org_id: viewer.org.id,
    client_id: clientId,
    name,
    phone: text(form, 'phone'),
    email: text(form, 'email'),
    is_primary: form.get('is_primary') === 'on',
  });
  return settle(error, 'Client contact added.');
}

export async function deleteClientContact(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const contactId = id(form, 'contact_id');
  if (!contactId) return fail('Missing contact.');
  const { error } = await viewer.supabase.from('client_contacts').delete().eq('id', contactId);
  return settle(error, 'Client contact removed.');
}
