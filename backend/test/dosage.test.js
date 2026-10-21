// Dosage list (defaults + a clinic's own, all editable, by Order):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSAGE_MASTER, cleanDosage, cleanOrder, defaultDosages, dosageOptions, nextOrder } from '../../shared/dosage.js';

test('a clinic starts with the three defaults at Order 1, 2, 3', () => {
  assert.deepEqual(DOSAGE_MASTER, ['1 Tablet', '2 Tablet', '4 Tablet']);
  assert.deepEqual(defaultDosages(), [{ value: '1 Tablet', sort_order: 1 }, { value: '2 Tablet', sort_order: 2 }, { value: '4 Tablet', sort_order: 3 }]);
  assert.deepEqual(dosageOptions(defaultDosages()), DOSAGE_MASTER);
});

test('the list follows Order; ties go alphabetically; repeats show once', () => {
  const rows = [...defaultDosages(), { value: '4 Drops', sort_order: 0 }, { value: '10 Drops', sort_order: 2 },
    { value: 'B', sort_order: 9 }, { value: 'A', sort_order: 9 }, { value: '2 tablet', sort_order: 50 }, null, { value: ' ' }];
  assert.deepEqual(dosageOptions(rows), ['4 Drops', '1 Tablet', '10 Drops', '2 Tablet', '4 Tablet', 'A', 'B']);
  // a renamed default is just another row
  assert.deepEqual(dosageOptions([{ value: '1 Tab', sort_order: 1 }]), ['1 Tab']);
});

test('new dosages go to the end; Order and text are tidied', () => {
  assert.equal(nextOrder([]), 1);
  assert.equal(nextOrder(defaultDosages()), 4);
  assert.equal(nextOrder([{ sort_order: 4 }, { sort_order: 100 }]), 101);
  assert.equal(cleanOrder('7'), 7);
  assert.equal(cleanOrder('-1'), null);
  assert.equal(cleanOrder('2.5'), null);
  assert.equal(cleanOrder('1000'), null);
  assert.equal(cleanDosage('  4   drops '), '4 drops');
  assert.equal(cleanDosage(null), '');
  assert.equal(cleanDosage('x'.repeat(150)).length, 100);
});

test('Repetition starts with TDS, QDS, OD, HS', async () => {
  const { defaultsFor, RX_LIST_KINDS } = await import('../../shared/dosage.js');
  assert.deepEqual(RX_LIST_KINDS, ['potency', 'dosage', 'repetition', 'dosdont', 'pasthistory']);
  assert.deepEqual(dosageOptions(defaultsFor('repetition')), ['TDS', 'QDS', 'OD', 'HS']);
});
