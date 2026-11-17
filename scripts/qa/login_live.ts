/**
 * QA of email-and-password sign-in on the deployed site: the portal chooser,
 * each portal's sign-in through its real form, the wrong-portal and
 * wrong-password answers, a crew applicant held at /pending until approved,
 * a self-signed-up client, sign-up and reset validation, and sign-out.
 *
 *   QA_BASE_URL, QA_PASSWORD (shared by the four accounts below)
 *   QA_PRODUCER_EMAIL, QA_CONTRACTOR_EMAIL, QA_APPLICANT_EMAIL, QA_CLIENT_EMAIL
 *   node --experimental-strip-types scripts/qa/login_live.ts
 */
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const BASE = env('QA_BASE_URL').replace(/\/$/, '');
const PASSWORD = env('QA_PASSWORD');

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
type Who = { cookie: string };
const decode = (s: string) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/g, '/');
const textOf = (html: string) =>
  decode(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

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

/** Cookies the server set, merged into a jar the next request sends. */
function absorb(who: Who, res: Response) {
  const jar = new Map(who.cookie.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)] as [string, string]));
  for (const sc of res.headers.getSetCookie()) {
    const [pair] = sc.split(';');
    const name = pair!.slice(0, pair!.indexOf('='));
    const value = pair!.slice(pair!.indexOf('=') + 1);
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
  who.cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}

async function get(who: Who, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: who.cookie }, redirect: 'manual' });
  absorb(who, res);
  return { status: res.status, location: res.headers.get('location') ?? '', html: res.status === 200 ? await res.text() : '' };
}

async function post(who: Who, path: string, button: string, fields: Record<string, string>) {
  const html = (await get(who, path)).html;
  const form = forms(html).find((f) => {
    const btn = /<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/.exec(f.html);
    return btn && textOf(btn[1] ?? '').trim() === button;
  });
  if (!form) return { status: 0, location: '', text: `no form with button "${button}" on ${path}` };
  const body = new FormData();
  const seen = new Set<string>();
  for (const [k, v] of defaults(form)) {
    if (k in fields) { if (!seen.has(k)) body.append(k, fields[k]!); seen.add(k); } else body.append(k, v);
  }
  for (const [k, v] of Object.entries(fields)) if (!seen.has(k)) body.append(k, v);
  const target = attr(`<form${form.attrs}>`, 'action');
  const to = target && target.startsWith('/') ? target : path;
  const res = await fetch(`${BASE}${to}`, { method: 'POST', headers: { cookie: who.cookie, origin: BASE, accept: 'text/html' }, body, redirect: 'manual' });
  absorb(who, res);
  return { status: res.status, location: res.headers.get('location') ?? '', text: textOf(await res.text()) };
}

const fresh = (): Who => ({ cookie: '' });

async function login(portal: string, email: string, password = PASSWORD) {
  const who = fresh();
  const r = await post(who, `/login/${portal}`, 'Sign in', { email, password });
  return { who, r };
}

async function main() {
  section('Signed out');
  let r0 = await get(fresh(), '/');
  const t = textOf(r0.html);
  check('/ is a chooser with all three portals', r0.status === 200 && ['Admin console', 'Crew', 'Client portal'].every((x) => t.includes(x)), r0.status);
  check('it offers crew and client sign-up, and says admin is by invitation', t.includes('Apply to join the crew') && t.includes('Create an account') && t.includes('by invitation'));
  for (const [path, portal] of [['/board', 'admin'], ['/clients', 'admin'], ['/app/jobs', 'contractor'], ['/pending', 'contractor'], ['/portal/invoices', 'client']] as const) {
    const r = await get(fresh(), path);
    check(`${path} sends a signed-out visitor to the ${portal} sign-in`, r.status === 307 && r.location.endsWith(`/login/${portal}`), r);
  }
  for (const p of ['admin', 'contractor', 'client']) {
    const r = await get(fresh(), `/login/${p}`);
    check(`/login/${p} shows an email and password form`, r.status === 200 && /name="email"/.test(r.html) && /name="password"/.test(r.html) && textOf(r.html).includes('Forgot password?'));
  }
  r0 = await get(fresh(), '/login/nobody');
  check('an unknown portal is not found', r0.status === 404);
  r0 = await get(fresh(), '/signup/admin');
  check('there is no admin sign-up', r0.status === 404);
  for (const p of ['contractor', 'client']) {
    const r = await get(fresh(), `/signup/${p}`);
    check(`/signup/${p} renders with name, email and two password fields`, r.status === 200 && /name="name"/.test(r.html) && /name="confirm"/.test(r.html), r.status);
  }

  section('Sign-up and reset checks (nothing is sent)');
  let r = await post(fresh(), '/signup/contractor', 'Apply', { name: 'QA', email: 'qa-x@demo.moments-to-media.invalid', password: 'short1', confirm: 'short1', terms: 'on' });
  check('a short password is refused', r.text.includes('at least 10 characters'), r.text.slice(0, 200));
  r = await post(fresh(), '/signup/client', 'Create account', { name: 'QA', email: 'qa-x@demo.moments-to-media.invalid', password: 'longpassword1', confirm: 'longpassword2', terms: 'on' });
  check('mismatched passwords are refused', r.text.includes('do not match'), r.text.slice(0, 200));
  r = await post(fresh(), '/signup/client', 'Create account', { name: '', email: 'qa-x@demo.moments-to-media.invalid', password: 'longpassword1', confirm: 'longpassword1', terms: 'on' });
  check('a missing name is refused', r.text.includes('full name'), r.text.slice(0, 200));
  r = await post(fresh(), '/forgot', 'Email me a link', { email: 'not-an-email' });
  check('reset asks for a real email', r.text.includes('Enter the email'), r.text.slice(0, 200));

  section('Admin sign-in');
  let s = await login('admin', env('QA_PRODUCER_EMAIL'), 'wrong-password-123');
  check('a wrong password is refused, without saying which part was wrong', s.r.text.includes('Wrong email or password.'), s.r.text.slice(0, 200));
  s = await login('admin', env('QA_PRODUCER_EMAIL'));
  check('a producer signs in to the admin console', s.r.status === 303 && s.r.location.endsWith('/board'), s.r);
  let page = await get(s.who, '/board');
  check('and the board opens', page.status === 200 && textOf(page.html).includes('Operations board'));
  page = await get(s.who, '/');
  check('/ sends them back to the board', page.status === 307 && page.location.endsWith('/board'));
  const out = await post(s.who, '/board', 'Sign out', {});
  check('signing out returns to the chooser', out.status === 303 && out.location.endsWith('/'), out);
  page = await get(s.who, '/board');
  check('and the session is gone', page.status === 307 && page.location.endsWith('/login/admin'), page);
  s = await login('client', env('QA_PRODUCER_EMAIL'));
  check('a producer at the client sign-in is told to use the admin console', s.r.text.includes('Sign in through the admin console'), s.r.text.slice(0, 300));
  page = await get(s.who, '/board');
  check('and is not left signed in', page.status === 307);

  section('Crew sign-in');
  s = await login('contractor', env('QA_CONTRACTOR_EMAIL'));
  check('a contractor signs in to the crew app', s.r.status === 303 && s.r.location.endsWith('/app'), s.r);
  page = await get(s.who, '/app');
  check('and their home opens', page.status === 200 && textOf(page.html).includes('Hi,'));
  page = await get(s.who, '/board');
  check('the admin console sends them back to the crew app', page.status === 307 && page.location.endsWith('/app'), page);
  s = await login('admin', env('QA_CONTRACTOR_EMAIL'));
  check('a contractor at the admin sign-in is told to use the crew sign-in', s.r.text.includes('Sign in through the crew'), s.r.text.slice(0, 300));

  section('Crew applicant, waiting for approval');
  s = await login('contractor', env('QA_APPLICANT_EMAIL'));
  check('an applicant signs in and lands on the pending page', s.r.status === 303 && s.r.location.endsWith('/pending'), s.r);
  page = await get(s.who, '/pending');
  check('the pending page says they are waiting and asks for their profile', page.status === 200 && textOf(page.html).includes('Thanks for applying') && textOf(page.html).includes('What you shoot'));
  r = await post(s.who, '/pending', 'Save', { full_name: 'QA Crew Applicant', phone: '555-0100', bio: 'QA portfolio' });
  check('they can save their profile while pending', r.status === 200 && !r.text.includes('role="alert"'));
  page = await get(s.who, '/app/jobs');
  check('jobs stay closed to them', page.status === 307 && page.location.endsWith('/pending'), page);
  const admin = await login('admin', env('QA_PRODUCER_EMAIL'));
  page = await get(admin.who, '/contractors');
  check('the producer sees the application on Contractors', textOf(page.html).includes('waiting for approval') && textOf(page.html).includes('QA Crew Applicant'));
  const membership = new RegExp('name="membership_id" value="([0-9a-f-]{36})"').exec(page.html)?.[1] ?? '';
  const approve = await (async () => {
    const f = forms(page.html).find((x) => x.html.includes(membership) && /value="approve"/.test(x.html));
    if (!f) return { status: 0 };
    const body = new FormData();
    for (const [k, v] of defaults(f)) body.append(k, v);
    const res = await fetch(`${BASE}/contractors`, { method: 'POST', headers: { cookie: admin.who.cookie, origin: BASE, accept: 'text/html' }, body, redirect: 'manual' });
    return { status: res.status, text: textOf(await res.text()) };
  })();
  check('the producer approves them', approve.status === 200 && !('text' in approve && approve.text.includes('role="alert"')), approve.status);
  s = await login('contractor', env('QA_APPLICANT_EMAIL'));
  check('once approved, they sign in to the crew app', s.r.status === 303 && s.r.location.endsWith('/app'), s.r);
  page = await get(s.who, '/app/jobs');
  check('and jobs open', page.status === 200 && textOf(page.html).includes('Open calls'));

  section('Client sign-in');
  s = await login('client', env('QA_CLIENT_EMAIL'));
  check('a client who signed up signs in to the portal', s.r.status === 303 && s.r.location.endsWith('/portal'), s.r);
  page = await get(s.who, '/portal');
  check('the portal opens (empty until a booking carries their email)', page.status === 200 && textOf(page.html).includes('Nothing here yet'));
  page = await get(s.who, '/app');
  check('the crew app sends them back to the portal', page.status === 307 && page.location.endsWith('/portal'), page);
  s = await login('contractor', env('QA_CLIENT_EMAIL'));
  check('a client at the crew sign-in is told to use the client portal', s.r.text.includes('Sign in through the client portal'), s.r.text.slice(0, 300));

  section('Emailed links still land');
  page = await get(fresh(), '/sign-in');
  check('/sign-in, where old and new emailed links land, still renders', page.status === 200 && textOf(page.html).includes('Signing you in'));
  page = await get(fresh(), '/forgot?portal=client');
  check('/forgot renders', page.status === 200 && textOf(page.html).includes('Reset your password'));
  page = await get(fresh(), '/account/password');
  check('/account/password needs a session from an emailed link', page.status === 307 && page.location.endsWith('/forgot'), page);

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
