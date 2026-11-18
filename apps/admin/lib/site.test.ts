import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('emailed links never take their address from request headers', () => {
  const mailer = readFileSync(new URL('./supabase/mailer.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mailer, /from 'next\/headers'/);
  assert.doesNotMatch(mailer, /\.get\('(x-forwarded-host|host)'\)/i);
  assert.match(mailer, /return SITE_URL;/);
});
