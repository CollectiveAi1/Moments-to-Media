import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, formatDay, formatTime, type EventRow, type SlotRow } from './build.ts';

const TZ = 'America/New_York';
// Thu Nov 12 2026, 6:00 PM in New York.
const NOW = new Date('2026-11-12T23:00:00Z');
const names = new Map([
  ['u-luis', 'Luis Ortega'],
  ['u-jordan', 'Jordan Lee'],
  ['u-kim', 'Kim Tran'],
]);
const nameOf = (id: string) => names.get(id) ?? 'A contractor';

function slot(over: Partial<SlotRow> = {}): SlotRow {
  return {
    id: 's1',
    role: 'Lead video',
    staffingMode: 'open_call',
    status: 'open_call',
    isRequired: true,
    callTime: '2026-11-12T22:30:00Z',
    earliestDueAt: null,
    assignments: [],
    ...over,
  };
}

function event(over: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    title: 'Harbor & Pine launch',
    status: 'staffing',
    startsAt: '2026-11-12T23:30:00Z',
    timeZone: TZ,
    producerId: 'p1',
    hasBrief: true,
    shotIds: [],
    slots: [slot()],
    ...over,
  };
}

const a = (id: string, userId: string, status: string, extra = {}) => ({
  id,
  userId,
  status,
  confirmDeadline: null,
  capturedShotIds: [],
  ...extra,
});

const column = (events: EventRow[], status: string) =>
  buildBoard(events, NOW, nameOf).columns.find((c) => c.status === status)!;

test('dates and times are written in the event time zone, not the server one', () => {
  assert.equal(formatDay('2026-11-13T02:00:00Z', TZ), 'Thu Nov 12');
  assert.equal(formatDay('2026-11-13T02:00:00Z', 'UTC'), 'Fri Nov 13');
  assert.equal(formatTime('2026-11-12T22:30:00Z', TZ), '5:30 PM');
  assert.equal(formatTime('2026-11-13T02:00:00Z', TZ), '9 PM');
});

test('a draft says what is missing', () => {
  const [card] = column([event({ status: 'draft', hasBrief: false, slots: [] })], 'draft').cards;
  assert.equal(card?.meta, 'Thu Nov 12 · 0 slots');
  assert.deepEqual(card?.lines.map((l) => l.text), ['Brief missing', 'No slots yet']);
  assert.equal(card?.actionable, false);
});

test('an open call with people waiting is the producer\'s move', () => {
  const e = event({
    slots: [slot({ assignments: [a('1', 'x', 'interested'), a('2', 'y', 'interested')] })],
  });
  const [card] = column([e], 'staffing').cards;
  assert.equal(card?.meta, 'Thu Nov 12 · 0 of 1 confirmed');
  assert.deepEqual(card?.lines, [{ text: '2 interested in Lead video · review', tone: 'label' }]);
  assert.equal(card?.actionable, true);
});

test('a selection waits on the contractor, and says until when', () => {
  const e = event({
    title: 'Northline Bank gala',
    slots: [
      slot({
        assignments: [
          a('1', 'u-jordan', 'selected', { confirmDeadline: '2026-11-13T02:00:00Z' }),
          a('2', 'x', 'interested'),
        ],
      }),
    ],
  });
  const board = buildBoard([e], NOW, nameOf);
  const [card] = board.columns.find((c) => c.status === 'staffing')!.cards;
  assert.deepEqual(card?.lines, [{ text: 'Jordan Lee selected · confirm due 9 PM', tone: 'warn' }]);
  assert.equal(card?.actionable, false);
  assert.deepEqual(board.attention.map((i) => [i.tone, i.text]), [
    ['warn', 'Northline Bank gala selection unconfirmed · due 9 PM'],
  ]);
});

test('only a confirm counts as staffed; interest and invites do not', () => {
  const e = event({
    slots: [
      slot({ id: 's1', assignments: [a('1', 'x', 'confirmed')] }),
      slot({ id: 's2', role: 'Photo', assignments: [a('2', 'y', 'invited')], staffingMode: 'direct_invite' }),
      slot({ id: 's3', role: 'Drone', isRequired: false }),
    ],
  });
  const [card] = column([e], 'staffing').cards;
  // The optional drone slot is not part of "of 2".
  assert.equal(card?.meta, 'Thu Nov 12 · 1 of 2 confirmed');
  assert.deepEqual(card?.lines.map((l) => l.text), ['1 invite out for Photo']);
});

test('confirmed and past call time without a check-in is a no-show', () => {
  const e = event({
    status: 'in_progress',
    shotIds: ['a', 'b', 'c', 'd'],
    slots: [
      slot({
        assignments: [
          a('1', 'u-luis', 'confirmed'),
          a('2', 'x', 'checked_in', { capturedShotIds: ['a', 'b'] }),
          a('3', 'y', 'checked_in', { capturedShotIds: ['b'] }),
        ],
      }),
    ],
  });
  const board = buildBoard([e], NOW, nameOf);
  const [card] = board.columns.find((c) => c.status === 'in_progress')!.cards;
  assert.equal(card?.meta, 'Tonight · 2 of 3 checked in');
  // Shot b was captured by two people and still counts once.
  assert.deepEqual(card?.lines, [{ text: 'Shot list 2 of 4', tone: 'muted' }]);
  assert.deepEqual(board.attention, [
    {
      key: 'noshow-1',
      tone: 'danger',
      text: 'Luis Ortega not checked in · Harbor & Pine launch, call 5:30 PM',
    },
  ]);
});

test('a call time that has not arrived, or is a day old, is not a no-show', () => {
  const future = event({
    status: 'staffed',
    slots: [slot({ callTime: '2026-11-13T22:30:00Z', assignments: [a('1', 'u-luis', 'confirmed')] })],
  });
  const stale = event({
    id: 'e2',
    status: 'staffed',
    slots: [slot({ callTime: '2026-11-10T22:30:00Z', assignments: [a('2', 'u-luis', 'confirmed')] })],
  });
  assert.deepEqual(buildBoard([future, stale], NOW, nameOf).attention, []);
});

test('uploads: ready for review is actionable, and a late one is named', () => {
  const e = event({
    title: 'Westside Expo',
    status: 'uploaded',
    slots: [
      slot({ id: 's1', role: 'Photo', assignments: [a('1', 'x', 'uploaded')] }),
      slot({
        id: 's2',
        role: 'Lead video',
        earliestDueAt: '2026-11-12T15:00:00Z',
        assignments: [a('2', 'u-kim', 'checked_out')],
      }),
    ],
  });
  const board = buildBoard([e], NOW, nameOf);
  const [card] = board.columns.find((c) => c.status === 'uploaded')!.cards;
  assert.equal(card?.meta, 'Thu Nov 12 · 1 of 2 uploaded');
  assert.deepEqual(card?.lines, [
    { text: 'Photo ready for review', tone: 'label' },
    { text: '1 overdue', tone: 'warn' },
  ]);
  assert.equal(card?.actionable, true);
  assert.deepEqual(board.attention.map((i) => i.text), ['Westside Expo upload overdue · Kim Tran']);
});

test('complete says paid only when everyone has been', () => {
  const paid = event({ status: 'complete', slots: [slot({ assignments: [a('1', 'x', 'paid')] })] });
  const owed = event({
    id: 'e2',
    status: 'complete',
    startsAt: '2026-11-08T23:30:00Z',
    slots: [slot({ assignments: [a('2', 'x', 'paid'), a('3', 'y', 'approved')] })],
  });
  const col = column([owed, paid], 'complete');
  // Newest first.
  assert.deepEqual(col.cards.map((c) => c.meta), ['Thu Nov 12 · paid', 'Sun Nov 8 · payout pending']);
});

test('active events exclude the finished ones, and danger sorts before warn', () => {
  const board = buildBoard(
    [
      event({ id: 'a', status: 'complete' }),
      event({
        id: 'b',
        status: 'staffing',
        slots: [slot({ callTime: '2026-11-20T22:30:00Z', assignments: [a('1', 'u-jordan', 'selected')] })],
      }),
      event({ id: 'c', status: 'in_progress', slots: [slot({ assignments: [a('2', 'u-luis', 'confirmed')] })] }),
    ],
    NOW,
    nameOf,
  );
  assert.equal(board.activeCount, 2);
  assert.deepEqual(board.attention.map((i) => i.tone), ['danger', 'warn']);
});
