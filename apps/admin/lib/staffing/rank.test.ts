import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availabilityOn, milesBetween, rank, type Candidate } from './rank.ts';

const base: Candidate = {
  userId: 'u',
  name: 'Base',
  homeLabel: 'Columbus',
  homeLat: 39.9612,
  homeLng: -82.9988,
  travelRadiusMiles: 50,
  gear: ['camera_body', 'lens'],
  availability: [],
  bookedElsewhere: false,
  complianceComplete: true,
  ratings: [],
  jobsDone: 0,
  jobsWithClient: 0,
};
const slot = { requiredGear: ['camera_body'], eventDate: '2026-11-21', eventLat: 39.9612, eventLng: -82.9988 };

test('distance is great-circle miles', () => {
  // Columbus to Cincinnati is about 98 miles as the crow flies.
  const d = milesBetween(39.9612, -82.9988, 39.1031, -84.512);
  assert.ok(d > 95 && d < 102, `got ${d}`);
});

test('a perfect match scores 90 with no availability set, 100 when marked available', () => {
  assert.equal(rank([base], slot)[0]?.score, 90);
  const available = { ...base, availability: [{ startsOn: '2026-11-21', endsOn: '2026-11-21', isAvailable: true, recurrenceDays: null }] };
  assert.equal(rank([available], slot)[0]?.score, 100);
});

test('outside the travel radius loses the area points and says why', () => {
  const far = { ...base, homeLat: 39.1031, homeLng: -84.512 }; // ~100 mi, travels 50
  const [r] = rank([far], slot);
  assert.equal(r?.score, 50);
  assert.match(r?.flags[0] ?? '', /Outside travel radius \(\d+ mi, travels 50\)/);
});

test('missing gear costs points in proportion', () => {
  const [r] = rank([{ ...base, gear: ['camera_body'] }], { ...slot, requiredGear: ['camera_body', 'drone'] });
  assert.deepEqual(r?.missingGear, ['drone']);
  assert.equal(r?.score, 40 + 15 + 20);
});

test('booked elsewhere outranks a marked-available day and scores zero for availability', () => {
  const booked = { ...base, bookedElsewhere: true, availability: [{ startsOn: '2026-11-01', endsOn: '2026-11-30', isAvailable: true, recurrenceDays: null }] };
  const [r] = rank([booked], slot);
  assert.equal(r?.availability, 'booked');
  assert.equal(r?.score, 70);
});

test('a specific day overrides a weekly pattern', () => {
  const rows = [
    { startsOn: '2026-01-01', endsOn: '2026-12-31', isAvailable: false, recurrenceDays: [6] }, // never Saturdays
    { startsOn: '2026-11-21', endsOn: '2026-11-21', isAvailable: true, recurrenceDays: null },
  ];
  assert.equal(availabilityOn(rows, '2026-11-21'), 'available');
  assert.equal(availabilityOn(rows, '2026-11-28'), 'unavailable');
  assert.equal(availabilityOn(rows, '2026-11-24'), 'unknown');
});

test('no coordinates on either side is neutral, not a penalty', () => {
  assert.equal(rank([{ ...base, homeLat: null, homeLng: null }], slot)[0]?.score, 70);
  assert.equal(rank([base], { ...slot, eventLat: null, eventLng: null })[0]?.distanceMiles, null);
});

test('ties break on reliability, then history with the client', () => {
  const a = { ...base, userId: 'a', name: 'A', ratings: [{ quality: 4, punctuality: 4, communication: 4 }] };
  const b = { ...base, userId: 'b', name: 'B', ratings: [{ quality: 5, punctuality: 5, communication: 5 }] };
  const c = { ...base, userId: 'c', name: 'C', ratings: [{ quality: 5, punctuality: 5, communication: 5 }], jobsWithClient: 3 };
  assert.deepEqual(rank([a, b, c], slot).map((r) => r.candidate.userId), ['c', 'b', 'a']);
  assert.equal(rank([a], slot)[0]?.reliability, 4);
});
