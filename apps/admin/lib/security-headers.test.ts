import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECURITY_HEADERS } from '../next.config.ts';

const header = (name: string) => SECURITY_HEADERS.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;

test('other sites cannot frame the app', () => {
  assert.equal(header('X-Frame-Options'), 'DENY');
  assert.match(header('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
});

test('the browser is told not to sniff types or leak paths', () => {
  assert.equal(header('X-Content-Type-Options'), 'nosniff');
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('only location is allowed, for check-in', () => {
  const p = header('Permissions-Policy') ?? '';
  assert.match(p, /geolocation=\(self\)/);
  assert.match(p, /camera=\(\)/);
  assert.match(p, /microphone=\(\)/);
});

test('the full policy is report-only and allows what uploads and checkout need', () => {
  const csp = header('Content-Security-Policy-Report-Only') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src [^;]*supabase\.co[^;]*r2\.cloudflarestorage\.com/);
  assert.match(csp, /form-action 'self' https:\/\/checkout\.stripe\.com/);
});
