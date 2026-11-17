import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate, amountDueNow, splitDeposit, todayIn } from './schedule.ts';

const sched = [
  { id: 'b', label: 'Balance', amountCents: 70_000, dueOn: '2026-12-01' },
  { id: 'd', label: 'Deposit', amountCents: 30_000, dueOn: '2026-11-17' },
];

test('payments fill the earliest installment first', () => {
  const s = allocate(sched, 40_000, '2026-11-20');
  assert.equal(s[0]?.id, 'd');
  assert.equal(s[0]?.state, 'paid');
  assert.equal(s[1]?.paidCents, 10_000);
  assert.equal(s[1]?.remainingCents, 60_000);
  assert.equal(s[1]?.state, 'partly_paid');
});

test('an unpaid installment past its date is overdue, and is what is due now', () => {
  const s = allocate(sched, 0, '2026-11-18');
  assert.equal(s[0]?.state, 'overdue');
  assert.deepEqual(amountDueNow(s), { cents: 30_000, label: 'Deposit' });
});

test('with nothing due yet, the next installment is offered', () => {
  const s = allocate(sched, 30_000, '2026-11-18');
  assert.deepEqual(amountDueNow(s), { cents: 70_000, label: 'Balance' });
});

test('several overdue installments are paid together', () => {
  const s = allocate(sched, 0, '2026-12-05');
  assert.deepEqual(amountDueNow(s), { cents: 100_000, label: 'Amount due now' });
});

test('a fully paid invoice has nothing due', () => {
  assert.equal(amountDueNow(allocate(sched, 100_000, '2026-12-05')), null);
});

test('deposit split rounds to the cent and keeps the total', () => {
  const { deposit, balance } = splitDeposit(311_025, 30);
  assert.equal(deposit, 93_308);
  assert.equal(deposit + balance, 311_025);
});

test('today is taken in the event zone, not UTC', () => {
  assert.equal(todayIn('America/Los_Angeles', new Date('2026-11-17T04:00:00Z')), '2026-11-16');
});

test('proposal totals match the database: add-ons only when chosen, tax after discount', async () => {
  const { proposalTotals } = await import('./schedule.ts');
  const items = [
    { priceCents: 250_000, quantity: 1, optional: false, selected: true },
    { priceCents: 40_000, quantity: 1, optional: true, selected: true },
    { priceCents: 10_000, quantity: 2, optional: true, selected: false },
  ];
  const t = proposalTotals(items, 0, 725, 30);
  assert.equal(t.total, 311_025);
  assert.equal(t.deposit, 93_308);
  const d = proposalTotals(items, 300_000, 725, 30);
  assert.equal(d.total, 0);
});
