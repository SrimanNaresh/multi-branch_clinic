// Examine → Advice → Do's and Don'ts:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultsFor, dosageOptions } from '../../shared/dosage.js';
import { cleanDosDonts, MAX_DOSDONTS, parseDosDonts } from '../../shared/dosdonts.js';

test("the Do's and Don'ts list starts with Smoking, Alcohol", () => {
  assert.deepEqual(dosageOptions(defaultsFor('dosdont')), ['Smoking', 'Alcohol']);
});

test('marks keep only do / dont, tidy the item, and keep each item once (last mark wins)', () => {
  assert.deepEqual(cleanDosDonts([
    { item: '  Smoking ', rule: 'dont' },
    { item: 'Alcohol', rule: 'maybe' },
    { item: '', rule: 'do' },
    null,
    { item: 'Walking', rule: 'do' },
    { item: 'smoking', rule: 'do' },
  ]), [{ item: 'Walking', rule: 'do' }, { item: 'smoking', rule: 'do' }]);
  assert.deepEqual(cleanDosDonts('Smoking'), []);
  assert.equal(cleanDosDonts(Array.from({ length: 80 }, (_, i) => ({ item: `x${i}`, rule: 'do' }))).length, MAX_DOSDONTS);
});

test('the saved column reads back as a list; empty or broken text is no marks', () => {
  assert.deepEqual(parseDosDonts('[{"item":"Alcohol","rule":"dont"}]'), [{ item: 'Alcohol', rule: 'dont' }]);
  assert.deepEqual(parseDosDonts(null), []);
  assert.deepEqual(parseDosDonts('not json'), []);
});
