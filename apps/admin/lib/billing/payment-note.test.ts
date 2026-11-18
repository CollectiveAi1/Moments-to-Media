import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentAfterNote } from './payment-note.ts';

test('a payment nothing happened to has no note', () => {
  assert.equal(paymentAfterNote({ amount_cents: 50_000, refunded_cents: 0, disputed_cents: 0, dispute_status: null }), null);
});

test('refunds say how much, or that it was all', () => {
  assert.equal(paymentAfterNote({ amount_cents: 50_000, refunded_cents: 12_500 }), '$125 refunded');
  assert.equal(paymentAfterNote({ amount_cents: 50_000, refunded_cents: 50_000 }), 'Refunded in full');
});

test('disputes show what is held until they close', () => {
  assert.equal(paymentAfterNote({ amount_cents: 50_000, disputed_cents: 50_000, dispute_status: 'needs_response' }), 'Card dispute open, $500 held');
  assert.equal(paymentAfterNote({ amount_cents: 50_000, disputed_cents: 0, dispute_status: 'won' }), 'Card dispute won');
  assert.equal(paymentAfterNote({ amount_cents: 50_000, disputed_cents: 50_000, dispute_status: 'lost' }), 'Card dispute lost');
});

test('a refund and a dispute on one payment both show', () => {
  assert.equal(
    paymentAfterNote({ amount_cents: 50_000, refunded_cents: 10_000, disputed_cents: 40_000, dispute_status: 'under_review' }),
    '$100 refunded · Card dispute open, $400 held',
  );
});
