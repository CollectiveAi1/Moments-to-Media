/**
 * QA of demo mode on the deployed site: the demo panel, each one-click demo
 * sign-in, the banner, the sample data each portal shows, the limits on demo
 * accounts, and switching portals.
 *
 *   QA_BASE_URL=https://… node --experimental-strip-types scripts/qa/demo_live.ts
 */
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



async function demo(portal: string) {
  const who = fresh();
  const html = (await get(who, '/')).html;
  const form = forms(html).find((f) => new RegExp(`name="portal" value="${portal}"`).test(f.html) && /Demo /.test(f.html));
  if (!form) return { who, status: 0, location: 'no demo button' };
  const body = new FormData();
  for (const [k, v] of defaults(form)) body.append(k, v);
  const res = await fetch(`${BASE}/`, { method: 'POST', headers: { cookie: who.cookie, origin: BASE, accept: 'text/html' }, body, redirect: 'manual' });
  absorb(who, res);
  return { who, status: res.status, location: res.headers.get('location') ?? '' };
}

async function main() {
  section('Demo panel');
  const home = await get(fresh(), '/');
  const t = textOf(home.html);
  check('the sign-in page shows the demo panel', t.includes('Demo mode') && t.includes('Try each portal with sample data'));
  check('with a button for each portal', ['Demo admin console', 'Demo crew', 'Demo client portal'].every((x) => t.includes(x)), t.slice(0, 400));
  const lp = await get(fresh(), '/login/client');
  check('each sign-in page links to the demo', textOf(lp.html).includes('Try the demo'));

  section('Demo admin');
  let d = await demo('admin');
  check('one click signs in to the admin console', d.status === 303 && d.location.endsWith('/board'), d);
  let p = await get(d.who, '/board');
  check('the board opens with the demo banner', p.status === 200 && textOf(p.html).includes('Demo mode') && textOf(p.html).includes('Sam Park, producer') && textOf(p.html).includes('Operations board'));
  p = await get(d.who, '/proposals');
  check('sample proposals are there', textOf(p.html).includes('Harper & Lee wedding film') && textOf(p.html).includes('Harper & Lee rehearsal dinner'));
  p = await get(d.who, '/invoices');
  check('a sample invoice is partly paid', textOf(p.html).includes('Partly paid'));
  p = await get(d.who, '/leads');
  check('sample inquiries are there', textOf(p.html).includes('Jordan Ellis') && textOf(p.html).includes('Priya & Sam'));
  p = await get(d.who, '/packages');
  check('sample packages are there', textOf(p.html).includes('Full-day wedding film'));
  let r = await post(d.who, '/contractors', 'Send invitation', { email: 'someone@example.com' });
  check('the demo admin cannot send invitation emails', r.text.includes('Demo accounts can’t send emails'), r.text.slice(0, 300));
  r = await post(d.who, '/board', 'Try another portal', {});
  check('“Try another portal” signs out back to the chooser', r.status === 303 && r.location.endsWith('/'), r);

  section('Demo crew');
  d = await demo('contractor');
  check('one click signs in to the crew app', d.status === 303 && d.location.endsWith('/app'), d);
  p = await get(d.who, '/app');
  check('crew home opens with the banner', p.status === 200 && textOf(p.html).includes('Maya Chen, photographer') && textOf(p.html).includes('Hi, Maya'));
  p = await get(d.who, '/app/profile/earnings');
  check('earnings open', p.status === 200 && textOf(p.html).includes('Earnings'));
  p = await get(d.who, '/board');
  check('the crew demo cannot open the admin console', p.status === 307 && p.location.endsWith('/app'), p);

  section('Demo client');
  d = await demo('client');
  check('one click signs in to the client portal', d.status === 303 && d.location.endsWith('/portal'), d);
  p = await get(d.who, '/portal');
  const pt = textOf(p.html);
  check('the portal shows the booking and balance with the banner', pt.includes('Avery Harper, wedding client') && pt.includes('Harper & Lee wedding film') && pt.includes('Review and pay'), pt.slice(0, 400));
  const inv = /\/portal\/invoices\/[0-9a-f-]{36}/.exec(p.html)?.[0] ?? '';
  p = await get(d.who, inv);
  check('the invoice shows the paid deposit and the schedule', textOf(p.html).includes('Deposit to book') && textOf(p.html).includes('Paid') && textOf(p.html).includes('Check'));
  p = await get(d.who, '/portal/messages');
  check('the studio’s message is there', textOf(p.html).includes('Your deposit is in'));
  const proj = /\/portal\/projects\/[0-9a-f-]{36}/.exec((await get(d.who, '/portal')).html)?.[0] ?? '';
  p = await get(d.who, proj);
  check('the project shows the signed contract', textOf(p.html).includes('Signed by Avery Harper'));
  r = await post(d.who, '/account/password', 'Save password', { password: 'anotherpass12', confirm: 'anotherpass12' });
  check('the demo client cannot change the password', r.text.includes('Demo accounts can’t'), r.text.slice(0, 300));

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
