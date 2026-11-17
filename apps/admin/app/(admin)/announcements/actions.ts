'use server';

import type { ActionResult } from '@/lib/action-types';
import type { Audience } from '@/lib/audience';
import { requireAdmin } from '@/lib/context';
import { fail, text } from '@/lib/errors';
import { zonedToUtc } from '@/lib/format';
import { settle } from '@/lib/mutate';

const UUID = /^[0-9a-f-]{36}$/i;

export async function postAnnouncement(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const body = text(form, 'body');
  if (!body) return fail('Write the announcement.');

  let audience: Audience = { kind: 'all' };
  const kind = text(form, 'kind');
  if (kind === 'skill') {
    const skill = text(form, 'skill');
    if (!skill) return fail('Name the skill, for example drone.');
    audience = { kind: 'skill', skill };
  } else if (kind === 'area') {
    const area = text(form, 'area');
    if (!area) return fail('Name the area, for example Columbus.');
    audience = { kind: 'area', area };
  } else if (kind === 'event') {
    const eventId = text(form, 'event_id');
    if (!eventId || !UUID.test(eventId)) return fail('Choose the event.');
    const { data: ev } = await viewer.supabase.from('events').select('title').eq('id', eventId).maybeSingle();
    audience = { kind: 'event', event_id: eventId, event_title: String(ev?.title ?? '') };
  }

  const date = text(form, 'date');
  const scheduled = date ? zonedToUtc(date, text(form, 'time') ?? '09:00', text(form, 'zone') ?? 'America/New_York').toISOString() : null;

  const { error } = await viewer.supabase.from('announcements').insert({
    org_id: viewer.org.id,
    author_id: viewer.userId,
    body,
    pinned: form.get('pinned') === 'on',
    audience,
    scheduled_for: scheduled,
  });
  return settle(error, scheduled ? 'Scheduled.' : 'Posted. Contractors see it on their home screen.');
}

export async function setPinned(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const id = text(form, 'announcement_id');
  if (!id || !UUID.test(id)) return fail('Missing announcement.');
  const pinned = text(form, 'pinned') === 'true';
  const { error } = await viewer.supabase.from('announcements').update({ pinned }).eq('id', id);
  return settle(error, pinned ? 'Pinned.' : 'Unpinned.');
}

export async function deleteAnnouncement(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  const id = text(form, 'announcement_id');
  if (!id || !UUID.test(id)) return fail('Missing announcement.');
  const { error } = await viewer.supabase.from('announcements').delete().eq('id', id);
  return settle(error, 'Deleted.');
}
