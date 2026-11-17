import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordProblem, portalForPath } from './portals.ts';

test('a signed-out visitor is sent to the sign-in for the portal they asked for', () => {
  assert.equal(portalForPath('/app/jobs'), 'contractor');
  assert.equal(portalForPath('/pending'), 'contractor');
  assert.equal(portalForPath('/portal/invoices/x'), 'client');
  assert.equal(portalForPath('/board'), 'admin');
  assert.equal(portalForPath('/application'), 'admin');
});

test('passwords need length, a letter and a number, and must match', () => {
  assert.equal(passwordProblem('short1'), 'Use at least 10 characters.');
  assert.equal(passwordProblem('longpasswordonly'), 'Use at least one letter and one number.');
  assert.equal(passwordProblem('longpassword1', 'longpassword2'), 'The two passwords do not match.');
  assert.equal(passwordProblem('longpassword1', 'longpassword1'), null);
});
