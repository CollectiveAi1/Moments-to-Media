import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendly } from './errors.ts';

const GENERIC = 'That could not be saved. Check the details and try again.';

test('Postgres internals never reach the screen', () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(friendly({ code: '23514', message: 'new row for relation "invoices" violates check constraint "invoices_tax_rate_bp_check"' }), GENERIC);
    assert.equal(friendly({ code: '23503', message: 'insert or update on table "leads" violates foreign key constraint "leads_client_same_org_fkey"' }), GENERIC);
    assert.equal(friendly({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' }), GENERIC);
    assert.equal(friendly({ code: '23502', message: 'null value in column "title" of relation "events" violates not-null constraint' }), GENERIC);
  } finally {
    console.error = quiet;
  }
});

test("the app's own messages still come through", () => {
  assert.equal(friendly({ code: 'P0001', message: 'uploads are off in the demo', hint: 'Demo accounts can look at uploads but not add files.' }),
    'Uploads are off in the demo. Demo accounts can look at uploads but not add files.');
  assert.equal(friendly({ code: '23514', message: 'event cannot move from draft to complete' }), 'This event cannot move from draft to complete.');
});

test('known codes keep their plain wording', () => {
  assert.equal(friendly({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }), 'That already exists.');
  assert.equal(friendly({ code: '42501', message: 'permission denied for table events' }), 'You do not have permission to do that.');
});
