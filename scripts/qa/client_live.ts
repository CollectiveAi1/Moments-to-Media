/**
 * QA of the client side against the deployed site, through its own pages and
 * forms: a producer builds and sends a proposal, an anonymous visitor sends an
 * inquiry and the client signs through the private link, the client signs in
 * and works their portal, the producer records a payment and they both see it.
 *
 *   QA_BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
 *   QA_PRODUCER_EMAIL / _PASSWORD, QA_CLIENT_EMAIL / _PASSWORD
 *   node --experimental-strip-types scripts/qa/client_live.ts
 *
 * Leaves one inquiry, one signed proposal, a Draft event and an invoice, all
 * titled "Client QA <time>", for the cleanup step to remove.
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


const anon = { cookie: '', id: '', db: null as unknown as Who['db'] } as Who;

async function main() {
  const producer = await session('QA_PRODUCER');
  const stamp = new Date().toISOString().slice(0, 16);
  const clientEmail = env('QA_CLIENT_EMAIL');

  section('Signed out');
  for (const p of ['/leads', '/proposals', '/invoices', '/clients', '/packages', '/portal']) {
    const r = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    check(`${p} sends a signed-out visitor to sign in`, r.status === 307 && (r.headers.get('location') ?? '').endsWith('/sign-in'), r.status);
  }

  section('Console pages, as a producer');
  await page(producer, '/leads', ['Inquiries', 'Your public inquiry form']);
  await page(producer, '/proposals', ['Proposals', 'New proposal']);
  await page(producer, '/proposals/new', ['New proposal', 'Create draft']);
  await page(producer, '/invoices', ['Invoices', 'Outstanding']);
  await page(producer, '/invoices/new', ['New invoice']);
  await page(producer, '/clients', ['Clients', 'Add a client']);
  await page(producer, '/packages', ['Packages', 'Add a package or add-on']);
  const sidebar = await get(producer, '/board');
  check('the sidebar lists the client section', ['Inquiries', 'Proposals', 'Invoices', 'Packages'].every((x) => textOf(sidebar.html).includes(x)));

  section('Packages');
  let html = await get(producer, '/packages').then((r) => r.html);
  let r = await submit(producer, '/packages', html, 'Add', { name: `Client QA package ${stamp}`, price: '2500', description: 'Two shooters, eight hours.' });
  check('add a package', r.status === 200 && !/alert/.test(r.text) && !r.text.includes('Enter a price'), r);
  html = await get(producer, '/packages').then((r) => r.html);
  r = await submit(producer, '/packages', html, 'Add', { name: `Client QA drone ${stamp}`, price: '400', is_addon: 'on' });
  html = await get(producer, '/packages').then((r) => r.html);
  check('packages show on the page', textOf(html).includes(`Client QA package ${stamp}`) && textOf(html).includes(`Client QA drone ${stamp}`));

  section('Public inquiry form, signed out');
  const leads = await get(producer, '/leads');
  const slug = /\/inquire\/([a-z0-9-]+)/.exec(leads.html)?.[1] ?? '';
  check('the inquiry page shows the form link', Boolean(slug));
  const form = await fetch(`${BASE}/inquire/${slug}`).then(async (x) => ({ status: x.status, html: await x.text() }));
  check('the inquiry form opens without an account and lists packages', form.status === 200 && textOf(form.html).includes('Check our availability') && textOf(form.html).includes(`Client QA package ${stamp}`), form.status);
  r = await submit(anon, `/inquire/${slug}`, form.html, 'Send inquiry', {
    name: `Client QA ${stamp}`, email: clientEmail, event_type: 'Wedding', event_date: new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10), location: 'Columbus', message: 'QA inquiry',
  });
  check('sending an inquiry thanks the visitor', r.status === 303 && (r.location ?? '').includes('sent=1'), r);
  r = await submit(anon, `/inquire/${slug}`, form.html, 'Send inquiry', { name: 'Bot', email: 'bot@example.com', website: 'http://spam' });
  check('a bot filling the hidden field is turned away', r.status !== 303);
  r = await submit(anon, `/inquire/${slug}`, form.html, 'Send inquiry', { name: 'No contact' });
  check('an inquiry without email or phone is refused with a reason', r.status === 200 && r.text.includes('email or a phone number'), r.text.slice(0, 200));

  html = await get(producer, '/leads').then((x) => x.html);
  check('the inquiry lands in New', textOf(html).includes(`Client QA ${stamp}`));
  const leadId = new RegExp(`/proposals/new\\?lead=([0-9a-f-]{36})`).exec(html.slice(html.indexOf(`Client QA ${stamp}`)))?.[1];
  check('the inquiry offers a Proposal button', Boolean(leadId));

  section('Proposal, built in the console');
  html = await get(producer, `/proposals/new?lead=${leadId}`).then((x) => x.html);
  check('a proposal from an inquiry starts filled in', textOf(html).includes(`Client QA ${stamp}`) && html.includes(clientEmail));
  r = await submit(producer, `/proposals/new?lead=${leadId}`, html, 'Create draft', { title: `Client QA ${stamp} wedding` });
  const proposalPath = r.location && /\/proposals\/[0-9a-f-]{36}/.exec(r.location)?.[0];
  check('Create draft opens the proposal', r.status === 303 && Boolean(proposalPath), r);
  if (!proposalPath) throw new Error('cannot continue without the proposal');
  html = await page(producer, proposalPath, [`Client QA ${stamp} wedding`, 'What’s offered', 'Contract']);
  const pkgs = [...html.matchAll(/<option value="([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => ({ id: m[1]!, label: textOf(m[2]!).trim() }));
  const main = pkgs.find((p) => p.label.includes(`Client QA package ${stamp}`));
  const drone = pkgs.find((p) => p.label.includes(`Client QA drone ${stamp}`));
  r = await submit(producer, proposalPath, html, 'Add', { package_id: main?.id ?? '' }, { proposal_id: '*' });
  html = await get(producer, proposalPath).then((x) => x.html);
  r = await submit(producer, proposalPath, html, 'Add', { package_id: drone?.id ?? '', optional: 'on' }, { proposal_id: '*' });
  html = await get(producer, proposalPath).then((x) => x.html);
  check('the package and an optional add-on are on the proposal', textOf(html).includes('Optional add-on') && textOf(html).includes('$2,500'), textOf(html).slice(0, 300));
  r = await submit(producer, proposalPath, html, 'Save', { tax_percent: '7.25' }, { proposal_id: '*' });
  check('details save', r.status === 200 && !r.text.includes('role="alert"'));
  html = await get(producer, proposalPath).then((x) => x.html);
  check('tax shows in the totals', textOf(html).includes('Tax (7.25%)'));
  r = await submit(producer, proposalPath, html, 'Send to client', {}, { proposal_id: '*' });
  html = await get(producer, proposalPath).then((x) => x.html);
  const token = /\/p\/([0-9a-f]{48,80})/.exec(html)?.[1];
  check('sending gives a private link', Boolean(token), textOf(html).slice(0, 300));
  if (!token) throw new Error('no link');
  r = await submit(producer, proposalPath, html, 'Remove');
  check('a sent proposal can no longer be edited (no Remove button)', r.status === 0);

  section('Proposal link, signed out');
  html = await fetch(`${BASE}/p/${token}`).then((x) => x.text());
  check('the client opens the link with no account', textOf(html).includes(`Client QA ${stamp} wedding`) && textOf(html).includes('Sign and book'));
  check('the add-on is offered with its price', textOf(html).includes(`Client QA drone ${stamp}`) && textOf(html).includes('$400.00'));
  html = await get(producer, proposalPath).then((x) => x.html);
  check('the producer sees it was opened', textOf(html).includes('opened') && textOf(html).includes('Viewed'));
  html = await fetch(`${BASE}/p/${token}`).then((x) => x.text());
  const signFields = { agree: 'on', signer: `Client QA ${stamp}`, signature: 'Someone Else', addon: drone ? (/name="addon" value="([0-9a-f-]{36})"/.exec(html)?.[1] ?? '') : '' };
  r = await submit(anon, `/p/${token}`, html, `Sign and book · ${/Sign and book · ([^<]+)/.exec(html)?.[1]?.trim() ?? ''}`, signFields);
  check('a signature that does not match the name is refused', r.status === 200 && r.text.includes('must match'), r.text.slice(0, 200));
  r = await submit(anon, `/p/${token}`, html, `Sign and book · ${/Sign and book · ([^<]+)/.exec(html)?.[1]?.trim() ?? ''}`, { ...signFields, signature: `Client QA ${stamp}` });
  check('signing books it', r.status === 303 && (r.location ?? '').includes('signed=1'), r);
  html = await fetch(`${BASE}/p/${token}?signed=1`).then((x) => x.text());
  check('the signed page confirms and points to the portal', textOf(html).includes('You’re booked!') && textOf(html).includes('Open my client portal'));
  check('the total includes the add-on and tax ($3,110.25)', textOf(html).includes('$3,110.25'), textOf(html).slice(0, 400));

  section('What signing created, in the console');
  html = await get(producer, proposalPath).then((x) => x.html);
  check('the proposal shows Signed with links to the event, invoice and client', textOf(html).includes('Signed by') && /\/events\/[0-9a-f-]{36}/.test(html) && /\/invoices\/[0-9a-f-]{36}/.test(html));
  const eventPath = /\/events\/[0-9a-f-]{36}/.exec(html)?.[0] ?? '';
  const invoicePath = /\/invoices\/[0-9a-f-]{36}/.exec(html)?.[0] ?? '';
  const clientPath = /\/clients\/[0-9a-f-]{36}/.exec(html)?.[0] ?? '';
  await page(producer, eventPath, [`Client QA ${stamp} wedding`, 'Draft', 'Client delivery and billing']);
  html = await page(producer, invoicePath, ['Invoice', 'Deposit to book', 'Balance', 'Open']);
  await page(producer, clientPath, [`Client QA ${stamp}`, 'Contacts and portal access', 'Messages']);
  html = await get(producer, '/leads').then((x) => x.html);
  check('the inquiry moved to Booked', /Booked[\s\S]*Client QA/.test(textOf(html)));

  section('Client portal');
  const client = await session('QA_CLIENT');
  const { error: claimErr } = await client.db.rpc('claim_invitations');
  check('signing in claims the portal invitation', !claimErr, claimErr);
  const fresh = await session('QA_CLIENT');
  html = await page(fresh, '/portal', ['Payments', 'Your projects', `Client QA ${stamp} wedding`]);
  check('the portal shows the balance to pay', textOf(html).includes('Review and pay'));
  const portalInvoice = /\/portal\/invoices\/[0-9a-f-]{36}/.exec(html)?.[0] ?? '';
  html = await page(fresh, portalInvoice, ['Deposit to book', 'Schedule', 'Receipts']);
  check('card payments are off, so the client is told how else to pay', textOf(html).includes('send a check, cash or bank transfer'));
  await page(fresh, '/portal/invoices', ['Invoices']);
  const project = `/portal/projects/${eventPath.split('/')[2]}`;
  await page(fresh, project, ['Your photos and video', 'Your contract', 'Signed by']);
  html = await get(fresh, '/portal/messages').then((x) => x.html);
  r = await submit(fresh, '/portal/messages', html, 'Send', { body: 'QA: when will the film be ready?' });
  check('the client sends a message', r.status === 200 && !r.text.includes('role="alert"'));
  const board = await get(fresh, '/board');
  check('the client cannot open the console', board.status === 307 && (board.location ?? '').endsWith('/portal'), board);
  const other = await get(fresh, '/app');
  check('the client cannot open the contractor app', other.status === 307 && (other.location ?? '').endsWith('/portal'), other);
  const root = await get(fresh, '/');
  check('the client lands in the portal', root.status === 307 && (root.location ?? '').endsWith('/portal'), root);

  section('Payment, recorded by the producer');
  html = await get(producer, clientPath).then((x) => x.html);
  check('the producer sees the client’s message', textOf(html).includes('QA: when will the film be ready?'));
  r = await submit(producer, clientPath, html, 'Send', { body: 'QA reply: about three weeks.' }, { client_id: '*' });
  html = await get(producer, invoicePath).then((x) => x.html);
  const depositMatch = /Deposit to book\s*Due [0-9-]+\s*\$([0-9,.]+)/.exec(textOf(html));
  const deposit = depositMatch?.[1]?.replace(/,/g, '') ?? '';
  r = await submit(producer, invoicePath, html, 'Record payment', { amount: deposit, method: 'check', reference: 'QA check 101' });
  check('the producer records the deposit check', r.status === 200 && !r.text.includes('role="alert"'), r.text.slice(0, 200));
  html = await get(producer, invoicePath).then((x) => x.html);
  check('the invoice is partly paid', textOf(html).includes('Partly paid'));
  html = await get(fresh, portalInvoice).then((x) => x.html);
  check('the client sees the receipt and the deposit marked paid', textOf(html).includes('Check') && textOf(html).includes('Paid'));
  html = await get(fresh, '/portal/messages').then((x) => x.html);
  check('the client sees the reply', textOf(html).includes('QA reply: about three weeks.'));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
