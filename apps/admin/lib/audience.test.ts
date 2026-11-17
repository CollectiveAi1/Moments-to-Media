import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAudience, parseAudience, reaches } from './audience.ts';

const maya = { skills: ['photo', 'video'], homeLabel: 'Columbus, OH', eventIds: ['e1'] };

test('anything unrecognised is everyone, which is the column default', () => {
  assert.deepEqual(parseAudience(null), { kind: 'all' });
  assert.deepEqual(parseAudience({ kind: 'skill' }), { kind: 'all' });
});

test('each kind reaches the right people', () => {
  assert.equal(reaches({ kind: 'all' }, maya), true);
  assert.equal(reaches({ kind: 'skill', skill: 'Drone' }, maya), false);
  assert.equal(reaches({ kind: 'skill', skill: 'PHOTO' }, maya), true);
  assert.equal(reaches({ kind: 'area', area: 'columbus' }, maya), true);
  assert.equal(reaches({ kind: 'event', event_id: 'e2' }, maya), false);
  assert.equal(reaches({ kind: 'event', event_id: 'e1' }, maya), true);
});

test('descriptions read as plain English', () => {
  assert.equal(describeAudience(parseAudience({ kind: 'event', event_id: 'x', event_title: 'Riverside 10K' })), 'Crew on Riverside 10K');
});
