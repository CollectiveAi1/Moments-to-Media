import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactUrl } from './analytics-redact.ts';

const SITE = 'https://moments-to-media-admin.vercel.app';
const TOKEN = 'a'.repeat(64);

test('proposal tokens never reach analytics', () => {
  assert.equal(redactUrl(`${SITE}/p/${TOKEN}`), `${SITE}/p/[token]`);
  assert.equal(redactUrl(`${SITE}/p/${TOKEN}?signed=1`), `${SITE}/p/[token]`);
  assert.ok(!redactUrl(`${SITE}/p/${TOKEN}/anything`).includes(TOKEN));
});

test('query strings and fragments are dropped everywhere', () => {
  assert.equal(redactUrl(`${SITE}/sign-in#access_token=secret&refresh_token=x`), `${SITE}/sign-in`);
  assert.equal(redactUrl(`${SITE}/portal/invoices/1?paid=1`), `${SITE}/portal/invoices/1`);
});

test('ordinary pages are untouched', () => {
  assert.equal(redactUrl(`${SITE}/login/client`), `${SITE}/login/client`);
  assert.equal(redactUrl(`${SITE}/privacy`), `${SITE}/privacy`);
  assert.equal(redactUrl(`${SITE}/portfolio`), `${SITE}/portfolio`);
});

test('a relative or odd value is still cleaned', () => {
  assert.equal(redactUrl(`/p/${TOKEN}?x=1`), '/p/[token]');
});
