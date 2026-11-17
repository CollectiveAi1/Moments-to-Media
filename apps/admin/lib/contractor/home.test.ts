import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needs, nextUp, type MyAssignment } from './home.ts';

const NOW = new Date('2026-11-20T15:00:00Z');
const a = (over: Partial<MyAssignment>): MyAssignment => ({
  id: 'a',
  status: 'confirmed',
  role: 'Photo',
  eventId: 'e',
  eventTitle: 'Gala',
  startsAt: '2026-11-21T23:00:00Z',
  timeZone: 'America/New_York',
  inviteExpiresAt: null,
  confirmDeadline: null,
  dueAt: null,
  changesNote: null,
  ...over,
});

test('a selection comes first, then invites, then changes, uploads and documents', () => {
  const list = needs(
    [
      a({ id: 'u', status: 'checked_out', dueAt: '2026-11-20T20:00:00Z' }),
      a({ id: 'c', status: 'changes_requested', changesNote: 'Need the wide' }),
      a({ id: 'i', status: 'invited', inviteExpiresAt: '2026-11-21T00:00:00Z' }),
      a({ id: 's', status: 'selected', confirmDeadline: '2026-11-21T02:00:00Z' }),
    ],
    [{ id: 'd', docType: 'insurance', status: 'approved', expiresOn: '2026-12-15' }],
    NOW,
  );
  assert.deepEqual(list.map((n) => n.kind), ['respond_selected', 'respond_invite', 'changes', 'upload', 'document']);
  assert.match(list[2]?.detail ?? '', /Need the wide/);
  assert.equal(list[3]?.urgent, true, 'due within a day');
  assert.equal(list[4]?.title, 'Document expiring');
});

test('a lapsed invitation or selection is not asked about', () => {
  const list = needs(
    [
      a({ id: 'i', status: 'invited', inviteExpiresAt: '2026-11-20T14:00:00Z' }),
      a({ id: 's', status: 'selected', confirmDeadline: '2026-11-19T00:00:00Z' }),
    ],
    [],
    NOW,
  );
  assert.equal(list.length, 0);
});

test('rejected and expired documents are urgent; far-off expiry is not mentioned', () => {
  const list = needs([], [
    { id: '1', docType: 'insurance', status: 'rejected', expiresOn: null },
    { id: '2', docType: 'contractor_agreement', status: 'approved', expiresOn: '2026-11-01' },
    { id: '3', docType: 'w9', status: 'approved', expiresOn: '2027-11-01' },
  ], NOW);
  assert.deepEqual(list.map((n) => n.title).sort(), ['Document expired', 'Document needs replacing']);
  assert.ok(list.every((n) => n.urgent));
});

test('next up is the job in progress, else the soonest confirmed one', () => {
  const later = a({ id: 'later', startsAt: '2026-11-25T23:00:00Z' });
  const sooner = a({ id: 'sooner', startsAt: '2026-11-21T23:00:00Z' });
  const past = a({ id: 'past', startsAt: '2026-11-18T23:00:00Z' });
  assert.equal(nextUp([later, sooner, past], NOW)?.id, 'sooner');
  assert.equal(nextUp([later, a({ id: 'on', status: 'checked_in', startsAt: '2026-11-20T13:00:00Z' })], NOW)?.id, 'on');
  assert.equal(nextUp([a({ status: 'invited' })], NOW), null);
});
