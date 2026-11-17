/**
 * Live QA of sign-in security on the deployed site:
 *   - the wrong-password message and the 5-tries pause;
 *   - session cookies are HttpOnly, Secure and SameSite=Lax;
 *   - /auth/session and /auth/token refuse cross-site requests;
 *   - "Sign out everywhere" ends other sessions;
 *   - unknown addresses get the 404 page; the SEO files are served.
 *
 *   QA_BASE_URL, QA_EMAIL, QA_PASSWORD (a client account for the sign-out test)
 *   node --experimental-strip-types scripts/qa/security_live.ts
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
  section('Wrong password and the pause');
  const nobody = `qa-nobody-${Date.now()}@demo.moments-to-media.invalid`;
  let s = await login('client', nobody, 'not-the-password-1');
  check('a wrong password says exactly “Wrong email or password.”', s.r.text.includes('Wrong email or password.'), s.r.text.slice(0, 200));
  for (let i = 0; i < 4; i++) s = await login('client', nobody, 'not-the-password-1');
  check('the fifth wrong try pauses sign-in', s.r.text.includes('Sign-in is paused for'), s.r.text.slice(0, 200));
  s = await login('client', nobody, 'not-the-password-1');
  check('and a sixth is refused before it reaches the password check', s.r.text.includes('Too many wrong passwords. Try again in'), s.r.text.slice(0, 200));

  section('Cookies');
  const a = fresh();
  const html = (await get(a, '/login/client')).html;
  const form = forms(html).find((f) => /name="portal" value="client"/.test(f.html) && /name="password"/.test(f.html))!;
  const body = new FormData();
  for (const [k, v] of defaults(form)) body.append(k, v);
  body.set('email', env('QA_EMAIL'));
  body.set('password', PASSWORD);
  const res = await fetch(`${BASE}/login/client`, { method: 'POST', headers: { origin: BASE, accept: 'text/html' }, body, redirect: 'manual' });
  absorb(a, res);
  const cookies = res.headers.getSetCookie().filter((c) => /^sb-/.test(c) && !/max-age=0/i.test(c));
  check('signing in sets the session cookie', res.status === 303 && cookies.length > 0, res.status);
  check('the session cookie is HttpOnly', cookies.every((c) => /;\s*httponly/i.test(c)), cookies.map((c) => c.split(';').slice(1).join(';')));
  check('… Secure', cookies.every((c) => /;\s*secure/i.test(c)));
  check('… and SameSite=Lax', cookies.every((c) => /samesite=lax/i.test(c)));

  section('Same-origin only');
  let r = await fetch(`${BASE}/auth/token`, { headers: { cookie: a.cookie, 'sec-fetch-site': 'cross-site' } });
  check('/auth/token refuses a cross-site request', r.status === 403, r.status);
  r = await fetch(`${BASE}/auth/token`, { headers: { cookie: a.cookie, 'sec-fetch-site': 'same-origin' } });
  const tok = r.ok ? ((await r.json()) as { access_token?: string }).access_token : undefined;
  check('/auth/token gives the signed-in page a short-lived token', r.status === 200 && typeof tok === 'string', r.status);
  r = await fetch(`${BASE}/auth/token`, { headers: { 'sec-fetch-site': 'same-origin' } });
  check('/auth/token gives a signed-out visitor nothing', r.status === 401, r.status);
  r = await fetch(`${BASE}/auth/session`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'x', refresh_token: 'y' }) });
  check('/auth/session refuses a cross-site sign-in', r.status === 403, r.status);

  section('Sign out everywhere');
  const b = (await login('client', env('QA_EMAIL'))).who;
  let p = await get(b, '/portal');
  check('a second device is signed in', p.status === 200);
  p = await get(a, '/account');
  check('Account and security offers sign out everywhere', textOf(p.html).includes('Sign out everywhere'));
  const out = await post(a, '/account', 'Sign out everywhere', {});
  check('signing out everywhere returns to the chooser', out.status === 303 && out.location.includes('signed_out=everywhere'), out);
  p = await get(b, '/portal');
  check('the other device is signed out too', p.status === 307 && p.location.endsWith('/login/client'), p);

  section('404 and site files');
  p = await get(fresh(), '/no-such-page-here');
  check('an unknown address shows the 404 page', p.status === 404 && false === false && (await fetch(`${BASE}/no-such-page-here`).then((x) => x.text())).includes('find that page'), p.status);
  p = await get(fresh(), '/board');
  check('a private area still sends a signed-out visitor to sign in', p.status === 307 && p.location.endsWith('/login/admin'));
  for (const [path, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'xml'], ['/favicon.ico', 'icon'], ['/apple-icon', 'image/png'], ['/opengraph-image', 'image/png'], ['/manifest.webmanifest', 'manifest'], ['/privacy', 'text/html']] as const) {
    const x = await fetch(`${BASE}${path}`);
    check(`${path} is served (${type})`, x.status === 200 && (x.headers.get('content-type') ?? '').includes(type), `${x.status} ${x.headers.get('content-type')}`);
  }
  const sm = await fetch(`${BASE}/sitemap.xml`).then((x) => x.text());
  check('the sitemap lists the public pages and inquiry form, and no test org', sm.includes('/inquire/mtm-demo') && !sm.includes('mtm-smoke') && !sm.includes('/board'));
  const home = await fetch(`${BASE}/`).then((x) => x.text());
  check('the home page has a title, description, share image and a Check availability button above the sign-in', /<title>Moments to Media · /.test(home) && /name="description"/.test(home) && /og:image/.test(home) && home.indexOf('Check availability') < home.indexOf('>Sign in<'));

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
