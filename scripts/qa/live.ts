/**
 * QA against the deployed site, through its own pages and forms.
 *
 * Signs in as an owner and a contractor (the session never leaves this
 * process), renders every page as each, then runs one event through its life
 * by submitting the app's real forms to the deployed server. The forms are
 * progressively enhanced, so posting them is exactly what a browser does with
 * JavaScript off, and it runs the same server actions a click runs.
 *
 * Two steps have no form, because the screen uses a script: check-in (it asks
 * the phone for its location first) and the producer's rating squares. Those
 * call the same database function, or fill the same hidden fields, the screen
 * would.
 *
 *   QA_BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
 *   QA_OWNER_EMAIL / _PASSWORD, QA_CONTRACTOR_EMAIL / _PASSWORD
 *   node --experimental-strip-types scripts/qa/live.ts
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const { createServerClient } = require('@supabase/ssr') as typeof import('@supabase/ssr');
const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const BASE = env('QA_BASE_URL').replace(/\/$/, '');

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
    const d = typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail)?.slice(0, 300);
    console.log(`  FAIL  ${label}${detail !== undefined ? `\n        ${d}` : ''}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);

const decode = (s: string) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/g, '/');
const textOf = (html: string) =>
  decode(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

// ---------------------------------------------------------------- sessions

async function session(prefix: string) {
  const jar = new Map<string, string>();
  const sb = createServerClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email: env(`${prefix}_EMAIL`), password: env(`${prefix}_PASSWORD`) });
  if (error || !data.session) throw new Error(`${prefix} could not sign in: ${error?.message}`);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  await db.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; '), id: data.user!.id, db };
}
type Who = Awaited<ReturnType<typeof session>>;

async function get(who: Who, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: who.cookie }, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' };
}

/** A page renders: 200, its heading is there, and no error boundary or failure text. */
async function page(who: Who, path: string, expect: string[]) {
  const r = await get(who, path);
  const t = textOf(r.html);
  const missing = expect.filter((e) => !t.includes(e));
  const broken = /could not load|unexpected error|Application error|This page could not be found/i.test(t);
  check(`${path} renders${expect.length ? ` (${expect[0]})` : ''}`, r.status === 200 && missing.length === 0 && !broken, r.status !== 200 ? `${r.status} ${r.location ?? ''}` : { missing, broken });
  return r.html;
}

// ------------------------------------------------------------------- forms

interface Form { html: string; attrs: string }

function forms(html: string): Form[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map((m) => ({ attrs: m[1] ?? '', html: m[2] ?? '' }));
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1] ?? '') : null;
}

/** The fields a browser would submit, from the form's own defaults. */
function defaults(form: Form): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of form.html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    const name = attr(tag, 'name');
    if (!name) continue;
    const type = attr(tag, 'type') ?? 'text';
    if ((type === 'checkbox' || type === 'radio') && !/\schecked=""/.test(tag)) continue;
    if (type === 'file' || type === 'submit') continue;
    out.push([name, attr(tag, 'value') ?? (type === 'checkbox' ? 'on' : '')]);
  }
  for (const m of form.html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const name = attr(m[0], 'name');
    if (name) out.push([name, decode(m[2] ?? '')]);
  }
  for (const m of form.html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name = attr(m[0], 'name');
    if (!name) continue;
    const options = [...(m[2] ?? '').matchAll(/<option\b[^>]*>/g)].map((o) => o[0]);
    const chosen = options.find((o) => /\sselected=""/.test(o)) ?? options[0];
    out.push([name, chosen ? attr(chosen, 'value') ?? '' : '']);
  }
  return out;
}

/**
 * Finds the form whose submit button reads `button` (and, if given, whose
 * hidden fields include `having`), fills `fields`, and posts it the way a
 * browser does. Returns the response, following nothing.
 */
async function submit(who: Who, path: string, html: string, button: string, fields: Record<string, string> = {}, having: Record<string, string> = {}) {
  const candidates = forms(html).filter((f) => {
    const btn = /<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/.exec(f.html);
    if (!btn || textOf(btn[1] ?? '').trim() !== button) return false;
    const d = new Map(defaults(f));
    return Object.entries(having).every(([k, v]) => (v === '*' ? d.has(k) : d.get(k) === v));
  });
  const form = candidates[0];
  if (!form) return { status: 0, location: null as string | null, text: `no form with button "${button}"` };

  const body = new FormData();
  const seen = new Set<string>();
  for (const [k, v] of defaults(form)) {
    if (k in fields) {
      if (!seen.has(k)) body.append(k, fields[k]!);
      seen.add(k);
    } else body.append(k, v);
  }
  for (const [k, v] of Object.entries(fields)) if (!seen.has(k)) body.append(k, v);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { cookie: who.cookie, origin: BASE, accept: 'text/html' },
    body,
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), text: textOf(await res.text()) };
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
};

// -------------------------------------------------------------------- run

async function main() {
  const owner = await session('QA_OWNER');
  const crew = await session('QA_CONTRACTOR');

  section('Signed out');
  for (const p of ['/board', '/app', '/events/new', '/payouts']) {
    const r = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    check(`${p} sends a signed-out visitor to sign in`, r.status === 307 && (r.headers.get('location') ?? '').endsWith('/sign-in'), r.status);
  }
  const signin = await fetch(`${BASE}/sign-in`).then((r) => r.text());
  check('/sign-in renders', textOf(signin).includes('Email me a sign-in link'));

  section('Every admin page, as the owner');
  await page(owner, '/board', ['Operations board']);
  await page(owner, '/events', ['Events', 'New event']);
  await page(owner, '/events?show=all', ['Events']);
  await page(owner, '/events/new', ['New event', 'Create draft event']);
  await page(owner, '/staffing', ['Staffing']);
  await page(owner, '/contractors', ['Contractors', 'Invite someone']);
  await page(owner, '/footage', ['Footage and review', 'Waiting for review', 'Footage library']);
  await page(owner, '/payouts', ['Payouts']);
  await page(owner, '/announcements', ['Announcements', 'New announcement']);
  await page(owner, '/settings', ['Settings', 'Organization', 'People']);
  const ownerApp = await get(owner, '/app');
  check('/app sends someone who is not a contractor to the board', ownerApp.status === 307 && (ownerApp.location ?? '').endsWith('/board'), ownerApp);

  section('Building an event through the forms');
  const title = `Live QA ${new Date().toISOString().slice(0, 16)}`;
  let html = await get(owner, '/events/new').then((r) => r.html);
  const created = await submit(owner, '/events/new', html, 'Create draft event', {
    title, date: tomorrow(), start_time: '18:00', end_time: '22:00', area_label: 'Short North', venue_name: 'QA Gallery',
    address: '10 QA St', client_id: '__new', new_client: `Live QA client ${Date.now()}`,
  });
  const eventId = /\/events\/([0-9a-f-]{36})/.exec(created.location ?? '')?.[1];
  check('New event creates a draft and opens it', created.status === 303 && Boolean(eventId), created);
  if (!eventId) throw new Error('cannot continue without the event');
  const eventPath = `/events/${eventId}`;
  await page(owner, `${eventPath}?created=1`, [title, 'Draft created']);

  html = (await get(owner, eventPath)).html;
  let r = await submit(owner, eventPath, html, 'Add slot', { role: 'QA photo', rate_type: 'flat', rate: '400', staffing_mode: 'direct_invite' });
  check('Add slot', r.text.includes('QA photo slot added.'), r.text);
  html = (await get(owner, eventPath)).html;
  r = await submit(owner, eventPath, html, 'Save brief', { summary: 'Live QA summary', body: 'Live QA brief. Second sentence. Third sentence.' });
  check('Save brief (the path that failed QA pass 1 before the fix)', r.text.includes('Brief saved.'), r.text);
  r = await submit(owner, eventPath, html, 'Save brief', { summary: 'Live QA summary', body: 'Live QA brief, revised. Second. Third.' });
  check('Save brief again, as an update', r.text.includes('Brief saved.'), r.text);
  html = (await get(owner, eventPath)).html;
  r = await submit(owner, eventPath, html, 'Add deliverable', { title: 'QA stills', due_date: tomorrow() });
  check('Add deliverable', r.text.includes('Deliverable added.'), r.text);
  r = await submit(owner, eventPath, html, 'Add shot', { title: 'QA must shot', must_have: 'on' });
  check('Add shot', r.text.includes('Shot added.'), r.text);
  r = await submit(owner, eventPath, html, 'Add contact', { name: 'QA on site', phone: '+15555550123', kind: 'on_site' });
  check('Add contact', r.text.includes('Contact added.'), r.text);
  html = (await get(owner, eventPath)).html;
  r = await submit(owner, eventPath, html, 'Add client contact', { name: 'QA client contact', email: 'client@qa.invalid' });
  check('Add client contact', r.text.includes('Client contact added.'), r.text);
  r = await submit(owner, eventPath, html, 'Save details', { title, dress_code: 'All black' });
  check('Save event details', r.text.includes('Event details saved.'), r.text);
  r = await submit(owner, eventPath, html, 'Open staffing', {}, { to: 'staffing' });
  check('Open staffing', r.text.includes('Staffing is open.'), r.text);

  section('Staffing');
  html = await page(owner, `${eventPath}/staffing`, [title, 'Invite directly']);
  r = await submit(owner, `${eventPath}/staffing`, html, 'Invite', {}, { user_id: crew.id });
  check('Invite the contractor from the ranked roster', r.text.includes('is invited'), r.text);

  section('Every contractor page, as the contractor');
  html = await page(crew, '/app', ['You were invited', title]);
  await page(crew, '/app/jobs', ['Open calls']);
  await page(crew, '/app/uploads', ['Uploads']);
  await page(crew, '/app/profile', ['Ready to work', 'Availability', 'Documents']);
  await page(crew, '/app/profile/earnings', ['Earnings', 'Bank details and tax forms']);
  const crewAdmin = await get(crew, '/board');
  check('/board sends a contractor to their app', crewAdmin.status === 307 && (crewAdmin.location ?? '').endsWith('/app'), crewAdmin);
  const hidden = await get(crew, eventPath);
  check('a contractor cannot open the admin event page', hidden.status === 307, hidden.status);
  const packetBefore = await get(crew, `/app/events/${eventId}`);
  check('the packet is unavailable before confirming (rule 2)', packetBefore.status === 404 || !packetBefore.html.includes('10 QA St'), packetBefore.status);

  r = await submit(crew, '/app', html, 'Confirm', {}, { event: title });
  check('Confirm the invitation from Home', r.text.includes(`Confirmed: ${title}`), r.text);
  html = await page(crew, `/app/events/${eventId}`, [title, '10 QA St', 'Live QA summary', 'QA on site', 'QA client contact']);

  // Check-in is a script on the page (it asks for location first); it calls
  // this same function.
  const { data: mine } = await crew.db.from('assignments').select('id, slot_id').eq('user_id', crew.id).eq('status', 'confirmed');
  const { data: slots } = await crew.db.from('slots').select('id').eq('event_id', eventId);
  const assignmentId = (mine ?? []).find((a) => (slots ?? []).some((s) => s.id === a.slot_id))?.id as string | undefined;
  const ci = await crew.db.rpc('check_in', { p_assignment: assignmentId, p_latitude: null, p_longitude: null });
  check('Check in', !ci.error, ci.error);

  const shotsPath = `/app/events/${eventId}/shots`;
  html = await page(crew, shotsPath, ['Shot list', 'QA must shot']);
  const shotForm = forms(html).find((f) => f.html.includes('QA must shot'));
  const shotId = shotForm ? new Map(defaults(shotForm)).get('shot_id') : undefined;
  // The row's button is the shot itself, so post that form by its fields.
  check('the shot row carries its form', Boolean(shotForm && shotId));
  const body = new FormData();
  for (const [k, v] of defaults(shotForm!)) body.append(k, v);
  const ticked = await fetch(`${BASE}${shotsPath}`, { method: 'POST', headers: { cookie: crew.cookie, origin: BASE }, body, redirect: 'manual' });
  check('Tick the must-have shot', ticked.status === 200, ticked.status);
  html = await page(crew, shotsPath, ['All must-haves captured']);
  r = await submit(crew, shotsPath, html, 'Check out');
  check('Check out', r.text.includes('Checked out.'), r.text);

  html = await page(crew, '/app/uploads', [title, 'Mark upload complete']);
  r = await submit(crew, '/app/uploads', html, 'Mark upload complete');
  check('Mark upload complete', r.text.includes('Upload marked complete.'), r.text);

  section('Contractor profile forms');
  html = (await get(crew, '/app/profile')).html;
  r = await submit(crew, '/app/profile', html, 'Save', { skills: 'photo, video', home_base_label: 'Columbus, OH', travel_radius_miles: '50' }, { skills: '*' });
  check('Save skills and coverage (the path that failed QA pass 1 before the fix)', r.text.includes('Saved. Open calls are matched'), r.text);
  r = await submit(crew, '/app/profile', html, 'Save', { full_name: 'Maya Chen', phone: '+15555550111' }, { full_name: '*' });
  check('Save contact details', r.text.includes('Saved.'), r.text);
  r = await submit(crew, '/app/profile', html, 'Add gear', { category: 'lens', make: 'QA', model: 'Lens' });
  check('Add gear', r.text.includes('Gear added.'), r.text);
  r = await submit(crew, '/app/profile', html, 'Submit for review', { doc_type: 'w9' });
  check('Submit a document for review', r.text.includes('Submitted.'), r.text);

  section('Review, payout and close, as the owner');
  await page(owner, '/footage', ['Ready for review']);
  const reviewPath = `${eventPath}/review/${assignmentId}`;
  html = await page(owner, reviewPath, ['Rate this job', 'Approve all deliverables', 'QA stills']);
  r = await submit(owner, reviewPath, html, 'Save rating', { quality: '5', punctuality: '4', communication: '5' });
  check('Save a rating', r.text.includes('Rating saved.'), r.text);
  r = await submit(owner, reviewPath, html, 'Approve all deliverables');
  check('Approve all deliverables', r.text.includes('Approved.'), r.text);

  html = await page(owner, '/payouts', ['Payouts']);
  const { data: payout } = await owner.db.from('payouts').select('id').eq('assignment_id', assignmentId).single();
  for (const [button, to, message] of [
    ['Submit', 'submitted', 'Submitted'],
    ['Approve', 'approved', 'Approved.'],
    ['Record sent', 'sent', 'Recorded as sent.'],
    ['Record paid', 'paid', 'Recorded as paid.'],
  ] as const) {
    html = (await get(owner, '/payouts')).html;
    r = await submit(owner, '/payouts', html, button, {}, { payout_id: String(payout?.id), to });
    check(`Payout: ${button}`, r.text.includes(message), r.text);
  }
  html = (await get(owner, eventPath)).html;
  r = await submit(owner, eventPath, html, 'Mark complete', {}, { to: 'complete' });
  check('Mark the event complete', r.text.includes('The event is complete.'), r.text);
  await page(crew, '/app/profile/earnings', ['$400', 'Paid']);

  section('Announcements, invitations, settings');
  html = (await get(owner, '/announcements')).html;
  r = await submit(owner, '/announcements', html, 'Post', { body: `${title}: announcement`, pinned: 'on' });
  check('Post an announcement', r.text.includes('Posted.'), r.text);
  await page(crew, '/app', [`${title}: announcement`]);
  html = (await get(owner, '/announcements')).html;
  const { data: ann } = await owner.db.from('announcements').select('id').eq('body', `${title}: announcement`).single();
  r = await submit(owner, '/announcements', html, 'Delete', {}, { announcement_id: String(ann?.id) });
  check('Delete the announcement', r.text.includes('Deleted.'), r.text);

  html = (await get(owner, '/contractors')).html;
  const qaEmail = `live-qa-${Date.now()}@demo.moments-to-media.invalid`;
  r = await submit(owner, '/contractors', html, 'Send invitation', { email: qaEmail, role: 'contractor', send: '' });
  check('Invite someone (without sending email)', r.text.includes(`${qaEmail} is invited as contractor`), r.text);
  html = (await get(owner, '/contractors')).html;
  const { data: inv } = await owner.db.from('org_invitations').select('id').eq('email', qaEmail).single();
  r = await submit(owner, '/contractors', html, 'Revoke', {}, { invitation_id: String(inv?.id) });
  check('Revoke the invitation', r.text.includes('Invitation revoked.'), r.text);
  await page(owner, `/contractors/${crew.id}`, ['Work history', title]);

  html = (await get(owner, '/settings')).html;
  r = await submit(owner, '/settings', html, 'Save settings');
  check('Save settings unchanged', r.text.includes('Settings saved.'), r.text);

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
