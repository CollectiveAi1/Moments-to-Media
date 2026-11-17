import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  crc64Base64, crc64Start, crc64Update, crc64nvmeBase64, crc64nvmeFinish, crc64nvmeInit, crc64nvmeUpdate, planPartBytes,
} from '../src/uploads.ts';

const vector = new TextEncoder().encode('123456789');

test('the reference implementation matches the published vector', () => {
  assert.equal(crc64nvmeFinish(crc64nvmeUpdate(crc64nvmeInit, vector)), 0xae8b14860a799888n);
  assert.equal(crc64nvmeBase64(vector), 'rosUhgp5mIg=');
});

test('the fast implementation matches the vector and the reference', () => {
  assert.equal(crc64Base64(crc64Update(crc64Start(), vector)), 'rosUhgp5mIg=');
  const data = new Uint8Array(100_003).map((_, i) => (i * 31 + 7) & 255);
  assert.equal(crc64Base64(crc64Update(crc64Start(), data)), crc64nvmeBase64(data));
  // The value the Python smoke-test implementation produced for these bytes.
  assert.equal(crc64Base64(crc64Update(crc64Start(), data)), 'rFA7lveZrcw=');
});

test('the fast implementation streams across arbitrary chunk boundaries', () => {
  const data = new Uint8Array(65_537).map((_, i) => (i * 7) & 255);
  const s = crc64Start();
  for (let i = 0; i < data.length; i += 4093) crc64Update(s, data.subarray(i, i + 4093));
  assert.equal(crc64Base64(s), crc64nvmeBase64(data));
});

test('the part planner keeps 50 GB at 8 MiB parts and grows parts past 80 GB', () => {
  assert.equal(planPartBytes(50 * 1024 ** 3), 8 * 1024 ** 2);
  assert.equal(planPartBytes(100 * 1024 ** 3), 16 * 1024 ** 2);
});
