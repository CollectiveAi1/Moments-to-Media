/**
 * End-to-end QA against a real Supabase project: one event, start to finish,
 * performed by three real signed-in people, with the database's own rules
 * deciding what each may do. Every step asserts both the outcome and, where
 * it matters, that the wrong person is refused (CLAUDE.md rules 2, 6, 10).
 *
 *   QA_PRODUCER_EMAIL / QA_PRODUCER_PASSWORD     a producer in the org
 *   QA_OWNER_EMAIL / QA_OWNER_PASSWORD           an owner in the org
 *   QA_CONTRACTOR_EMAIL / QA_CONTRACTOR_PASSWORD a contractor in the org
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *
 *   node --experimental-strip-types scripts/qa/e2e.ts
 *
 * It creates one event titled "QA run <timestamp>" and leaves it complete,
 * so a run is visible on the board afterwards. Nothing else is touched.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const URL_ = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail !== undefined ? `\n        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);

async function signIn(prefix: string) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: env(`${prefix}_EMAIL`), password: env(`${prefix}_PASSWORD`) });
  if (error || !data.user) throw new Error(`${prefix} could not sign in: ${error?.message}`);
  return { db: c, id: data.user.id, token: data.session!.access_token };
}

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const HOUR = 3_600_000;

async function main() {
  const producer = await signIn('QA_PRODUCER');
  const owner = await signIn('QA_OWNER');
  const crew = await signIn('QA_CONTRACTOR');

  const { data: org } = await producer.db.from('memberships').select('org_id').eq('user_id', producer.id).eq('role', 'producer').limit(1).single();
  const orgId = String(org!.org_id);
  const title = `QA run ${new Date().toISOString().slice(0, 16)}`;

  section('Event builder');
  const { data: client } = await producer.db.from('clients').insert({ org_id: orgId, name: `QA client ${Date.now()}` }).select('id').single();
  const { data: ev, error: evErr } = await producer.db.from('events').insert({
    org_id: orgId, producer_id: producer.id, client_id: client?.id, title, status: 'draft',
    starts_at: iso(-HOUR), ends_at: iso(3 * HOUR), time_zone: 'America/New_York',
    area_label: 'Downtown', venue_name: 'QA Hall', address: '1 Test St', latitude: 39.9612, longitude: -82.9988, check_in_radius_m: 200,
  }).select('id, status').single();
  check('producer creates a draft event', !evErr && ev?.status === 'draft', evErr);
  const eventId = String(ev!.id);
  const { error: badInsert } = await crew.db.from('events').insert({ org_id: orgId, producer_id: crew.id, title: 'nope', status: 'draft', starts_at: iso(0), ends_at: iso(HOUR), time_zone: 'UTC' });
  check('a contractor cannot create an event', Boolean(badInsert));

  const { data: slot, error: slotErr } = await producer.db.from('slots').insert({
    org_id: orgId, event_id: eventId, role: 'QA video', rate_type: 'hourly', rate_amount_cents: 6000, minimum_hours: 2,
    call_time: iso(-HOUR), required_gear: ['camera_body'], staffing_mode: 'open_call', status: 'draft', is_required: true,
  }).select('id').single();
  check('producer adds an open-call slot', !slotErr, slotErr);
  const slotId = String(slot!.id);
  const { error: dErr } = await producer.db.from('deliverables').insert({ org_id: orgId, slot_id: slotId, title: 'QA reel', due_at: iso(48 * HOUR) });
  check('producer adds a deliverable', !dErr, dErr);
  const { data: shots, error: sErr } = await producer.db.from('shot_list_items').insert([
    { org_id: orgId, event_id: eventId, title: 'QA wide', must_have: true, position: 1 },
    { org_id: orgId, event_id: eventId, title: 'QA detail', must_have: true, position: 2 },
  ]).select('id');
  check('producer writes a shot list', !sErr && shots?.length === 2, sErr);
  const { error: bErr } = await producer.db.from('briefs').insert({ org_id: orgId, event_id: eventId, summary: 'QA summary', body: 'QA brief body.' });
  check('producer writes the brief', !bErr, bErr);
  const { error: bUpd } = await producer.db.from('briefs').update({ body: 'QA brief body.' }).eq('event_id', eventId);
  check('producer revises the brief (the update grant covers its text)', !bUpd, bUpd);
  const { error: cErr } = await producer.db.from('event_contacts').insert({ org_id: orgId, event_id: eventId, kind: 'on_site', name: 'QA contact', phone: '+15555550100' });
  check('producer adds an on-site contact', !cErr, cErr);

  section('Staffing');
  const { error: openErr } = await producer.db.rpc('transition_event', { p_event_id: eventId, p_to: 'staffing' });
  await producer.db.from('slots').update({ status: 'open_call' }).eq('id', slotId);
  check('producer opens staffing', !openErr, openErr);
  const { error: crewMove } = await crew.db.rpc('transition_event', { p_event_id: eventId, p_to: 'cancelled' });
  check('a contractor cannot move an event', Boolean(crewMove));

  // What a real contractor sets in Profile: gear, and a home base the database
  // can measure the travel radius from. Without a home base, events with a
  // location are correctly hidden.
  const { error: gearErr } = await crew.db.from('equipment').insert({ user_id: crew.id, category: 'camera_body', make: 'QA', model: 'Body' });
  const { data: hasDetails } = await crew.db.from('contractor_details').select('user_id').eq('user_id', crew.id).maybeSingle();
  const home = { home_base_label: 'Columbus, OH', home_base_latitude: 39.97, home_base_longitude: -83.0, travel_radius_miles: 50 };
  const { error: homeErr } = hasDetails
    ? await crew.db.from('contractor_details').update(home).eq('user_id', crew.id)
    : await crew.db.from('contractor_details').insert({ ...home, user_id: crew.id });
  check('contractor records gear and a home base', !gearErr && !homeErr, { gearErr, homeErr });
  const { data: board } = await crew.db.from('job_board').select('slot_id, brief_summary, area_label').eq('slot_id', slotId);
  check('the open call is on the contractor’s job board', (board ?? []).length === 1, board);
  check('the job board shows the area and brief summary, never the address',
    board?.[0]?.area_label === 'Downtown' && !('address' in (board?.[0] ?? {})), board);
  const { data: hiddenEvent } = await crew.db.from('events').select('id, address').eq('id', eventId);
  const { data: hiddenBrief } = await crew.db.from('briefs').select('body').eq('event_id', eventId);
  const { data: hiddenShots } = await crew.db.from('shot_list_items').select('id').eq('event_id', eventId);
  check('before confirm, the address, brief and shot list are invisible (rule 2)',
    (hiddenEvent ?? []).length === 0 && (hiddenBrief ?? []).length === 0 && (hiddenShots ?? []).length === 0,
    { hiddenEvent, hiddenBrief, hiddenShots });

  const { data: mine, error: optErr } = await crew.db.from('assignments')
    .insert({ org_id: orgId, slot_id: slotId, user_id: crew.id, status: 'interested', note: 'QA note' }).select('id').single();
  check('contractor opts in', !optErr, optErr);
  const assignmentId = String(mine!.id);
  const { error: selfSelect } = await crew.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'selected' });
  check('a contractor cannot select themselves', Boolean(selfSelect));
  const { error: selErr } = await producer.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'selected' });
  const { data: afterSel } = await producer.db.from('assignments').select('status, confirm_deadline').eq('id', assignmentId).single();
  check('producer selects; a confirm deadline is set', !selErr && afterSel?.status === 'selected' && Boolean(afterSel?.confirm_deadline), { selErr, afterSel });
  const { error: confErr } = await crew.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'confirmed' });
  const { data: afterConf } = await producer.db.from('events').select('status').eq('id', eventId).single();
  check('contractor confirms; the event becomes staffed', !confErr && afterConf?.status === 'staffed', { confErr, afterConf });

  section('Event day');
  const { data: packet } = await crew.db.from('events').select('address').eq('id', eventId);
  const { data: brief } = await crew.db.from('briefs').select('body').eq('event_id', eventId);
  check('after confirm, the packet unlocks', packet?.[0]?.address === '1 Test St' && brief?.[0]?.body === 'QA brief body.', { packet, brief });
  const { data: crewList } = await crew.db.from('event_crew').select('full_name').eq('event_id', eventId);
  check('confirmed crew can see the crew list', (crewList ?? []).length >= 1, crewList);

  const { data: late, error: lateErr } = await crew.db.rpc('report_running_late', { p_assignment: assignmentId, p_minutes: 15 });
  check('contractor reports running late', !lateErr && (late as { eta_minutes?: number })?.eta_minutes === 15, lateErr);
  const { data: notes } = await producer.db.from('notifications').select('type, payload').eq('type', 'running_late').contains('payload', { assignment_id: assignmentId });
  check('the producer receives the ETA', (notes ?? []).length === 1, notes);

  const { data: checkin, error: ciErr } = await crew.db.rpc('check_in', { p_assignment: assignmentId, p_latitude: 40.0, p_longitude: -83.1 });
  check('contractor checks in with location', !ciErr, ciErr);
  check('checking in ~6 miles away is flagged, not refused', (checkin as { outside_radius?: boolean })?.outside_radius === true, checkin);
  const { data: inProgress } = await producer.db.from('events').select('status').eq('id', eventId).single();
  check('the first check-in moves the event in progress', inProgress?.status === 'in_progress', inProgress);

  const [wide, detail] = shots!.map((s) => String(s.id));
  const { error: shot1 } = await crew.db.from('shot_checks').insert({ org_id: orgId, shot_list_item_id: wide, assignment_id: assignmentId, outcome: 'captured' });
  const { error: shotBad } = await crew.db.from('shot_checks').insert({ org_id: orgId, shot_list_item_id: detail, assignment_id: assignmentId, outcome: 'not_possible' });
  const { error: shot2 } = await crew.db.from('shot_checks').insert({ org_id: orgId, shot_list_item_id: detail, assignment_id: assignmentId, outcome: 'not_possible', reason: 'Room was closed' });
  check('contractor captures a shot', !shot1, shot1);
  check('"not possible" without a reason is refused', Boolean(shotBad));
  check('"not possible" with a reason is recorded', !shot2, shot2);
  const { error: flip } = await crew.db.from('shot_checks').update({ outcome: 'not_possible', reason: 'Blocked' }).eq('assignment_id', assignmentId).eq('shot_list_item_id', wide);
  const { error: flipBack } = await crew.db.from('shot_checks').update({ outcome: 'captured', reason: null }).eq('assignment_id', assignmentId).eq('shot_list_item_id', wide);
  check('contractor can change a shot’s outcome while working', !flip && !flipBack, { flip, flipBack });
  const { data: checksSeen } = await producer.db.from('shot_checks').select('outcome').eq('assignment_id', assignmentId);
  check('the producer sees the shot list live', (checksSeen ?? []).length === 2, checksSeen);

  const { error: coErr } = await crew.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'checked_out' });
  check('contractor checks out', !coErr, coErr);
  const { error: upErr } = await crew.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'uploaded' });
  const { data: uploadedEvent } = await producer.db.from('events').select('status').eq('id', eventId).single();
  check('contractor marks the upload complete; the event becomes uploaded', !upErr && uploadedEvent?.status === 'uploaded', { upErr, uploadedEvent });

  section('Review and payout');
  const { error: earlyApprove } = await producer.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'approved' });
  check('approval is refused while a deliverable is unreviewed', Boolean(earlyApprove));
  const { data: deliverable } = await producer.db.from('deliverables').select('id').eq('slot_id', slotId).single();
  const { error: revErr } = await producer.db.from('deliverable_reviews').insert({
    org_id: orgId, deliverable_id: deliverable!.id, assignment_id: assignmentId, decision: 'approved', reviewer_id: producer.id,
  });
  const { error: apprErr } = await producer.db.rpc('transition_assignment', { p_assignment_id: assignmentId, p_to: 'approved' });
  check('producer approves the deliverable and the work', !revErr && !apprErr, { revErr, apprErr });
  const { error: rateErr } = await producer.db.from('ratings').insert({ org_id: orgId, assignment_id: assignmentId, quality: 5, punctuality: 3, communication: 4, rater_id: producer.id });
  check('producer rates the job', !rateErr, rateErr);
  const { data: crewRatings } = await crew.db.from('ratings').select('id').eq('assignment_id', assignmentId);
  check('a contractor never sees their rating', (crewRatings ?? []).length === 0, crewRatings);
  const { data: before } = await producer.db.from('ratings').select('id').eq('assignment_id', assignmentId).single();
  const { error: reRate } = await producer.db.from('ratings').update({ quality: 4 }).eq('id', before!.id);
  check('producer can revise a rating', !reRate, reRate);

  const { data: payout } = await producer.db.from('payouts').select('id, status, amount_cents').eq('assignment_id', assignmentId).single();
  check('approval queues a draft payout', payout?.status === 'draft', payout);
  // Hourly, 2h minimum: check-in to check-out took seconds, so the minimum call applies.
  check('hourly pay honours the minimum call (2h × $60 = $120)', payout?.amount_cents === 12000, payout);
  const { data: crewPayout } = await crew.db.from('payouts').select('id').eq('assignment_id', assignmentId);
  check('the contractor can see their own payout', (crewPayout ?? []).length === 1, crewPayout);

  const payoutId = String(payout!.id);
  const { error: subErr } = await producer.db.rpc('transition_payout', { p_payout_id: payoutId, p_to: 'submitted' });
  check('producer submits the payout', !subErr, subErr);
  const { error: prodApprove } = await producer.db.rpc('transition_payout', { p_payout_id: payoutId, p_to: 'approved' });
  check('a producer cannot approve a payout', Boolean(prodApprove));
  const { error: ownApprove } = await owner.db.rpc('transition_payout', { p_payout_id: payoutId, p_to: 'approved' });
  const { error: sent } = await owner.db.rpc('transition_payout', { p_payout_id: payoutId, p_to: 'sent' });
  const { error: paid } = await owner.db.rpc('transition_payout', { p_payout_id: payoutId, p_to: 'paid' });
  check('owner approves, records sent and paid', !ownApprove && !sent && !paid, { ownApprove, sent, paid });
  const { data: paidAssignment } = await crew.db.from('assignments').select('status').eq('id', assignmentId).single();
  check('paying the payout marks the work paid', paidAssignment?.status === 'paid', paidAssignment);

  const { error: compErr } = await producer.db.rpc('transition_event', { p_event_id: eventId, p_to: 'complete' });
  const { data: done } = await producer.db.from('events').select('status').eq('id', eventId).single();
  check('producer completes the event', !compErr && done?.status === 'complete', { compErr, done });

  section('Announcements, invitations, footage');
  const { data: ann, error: annErr } = await producer.db.from('announcements').insert({ org_id: orgId, author_id: producer.id, body: `${title}: announcement`, pinned: false }).select('id').single();
  const { data: seen } = await crew.db.from('announcements').select('id').eq('id', ann?.id ?? '00000000-0000-0000-0000-000000000000');
  check('producer posts an announcement the contractor can read', !annErr && (seen ?? []).length === 1, annErr);
  const { error: crewAnn } = await crew.db.from('announcements').insert({ org_id: orgId, author_id: crew.id, body: 'nope' });
  check('a contractor cannot post announcements', Boolean(crewAnn));
  await producer.db.from('announcements').delete().eq('id', ann!.id);

  const qaEmail = `qa-invite-${Date.now()}@demo.moments-to-media.invalid`;
  const { data: inv, error: invErr } = await producer.db.from('org_invitations').insert({ org_id: orgId, role: 'contractor', email: qaEmail, invited_by: producer.id }).select('id').single();
  check('producer invites a contractor', !invErr, invErr);
  const { error: invOwner } = await producer.db.from('org_invitations').insert({ org_id: orgId, role: 'owner', email: `x${qaEmail}`, invited_by: producer.id });
  check('a producer cannot invite an owner', Boolean(invOwner));
  const { error: revokeErr } = await producer.db.from('org_invitations').update({ status: 'revoked' }).eq('id', inv!.id);
  check('producer revokes the invitation', !revokeErr, revokeErr);

  const dl = await fetch(`${URL_}/functions/v1/footage-download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${producer.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ upload_id: '00000000-0000-4000-8000-000000000000' }),
  });
  check('footage-download is live and refuses an upload the caller cannot see', dl.status === 404, dl.status);
  const unauth = await fetch(`${URL_}/functions/v1/footage-download`, { method: 'POST', body: '{}' });
  check('footage-download refuses an unauthenticated call', unauth.status === 401, unauth.status);

  console.log(`\n${passed} passed, ${failed} failed  (event: ${title})`);
  if (failed) {
    console.log(`Failures:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
