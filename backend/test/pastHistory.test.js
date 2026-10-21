// Examine → Complaints & diagnosis → Past History:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultsFor, dosageOptions } from '../../shared/dosage.js';
import { cleanAnswers, cleanPastHistory, MAX_PAST_NOTE, parsePastHistory, pastQuestionDefaults } from '../../shared/pastHistory.js';

test('the Past History list starts with ENT, Ortho, Dental', () => {
  assert.deepEqual(dosageOptions(defaultsFor('pasthistory')), ['ENT', 'Ortho', 'Dental']);
});

test('ticked items keep a tidy note, drop empty items and keep each item once (last wins)', () => {
  assert.deepEqual(cleanPastHistory([
    { item: ' ENT ', note: '  Tonsillectomy   2019 ' },
    { item: '', note: 'x' },
    { item: 'Dental' },
    null,
    { item: 'ent', note: 'Sinusitis' },
  ]), [{ item: 'Dental', note: '' }, { item: 'ent', note: 'Sinusitis' }]);
  assert.equal(cleanPastHistory([{ item: 'Ortho', note: 'y'.repeat(300) }])[0].note.length, MAX_PAST_NOTE);
  assert.deepEqual(cleanPastHistory('ENT'), []);
});

test('the saved column reads back as a list; empty or broken text is nothing ticked', () => {
  assert.deepEqual(parsePastHistory('[{"item":"Ortho","note":"Knee"}]'), [{ item: 'Ortho', note: 'Knee' }]);
  assert.deepEqual(parsePastHistory(''), []);
  assert.deepEqual(parsePastHistory('{bad'), []);
});

test('ENT starts with its seven questions; other items start with none', () => {
  assert.deepEqual(pastQuestionDefaults(' ent ').map((q) => q.value),
    ['Symptom Character', 'Triggers', 'Duration', 'Tinnitus', 'Hearing Changes', 'Infections', 'Barotrauma']);
  assert.deepEqual(pastQuestionDefaults('Ortho'), []);
});

test('answers keep only filled ones, once per question, and ride along with the item', () => {
  assert.deepEqual(cleanAnswers([
    { q: 'Duration', a: ' 2  years ' }, { q: 'Tinnitus', a: '  ' }, { q: '', a: 'x' }, { q: 'duration', a: '3 years' },
  ]), [{ q: 'duration', a: '3 years' }]);
  assert.deepEqual(cleanPastHistory([{ item: 'ENT', note: '', answers: [{ q: 'Triggers', a: 'Cold' }] }, { item: 'Ortho', answers: [] }]),
    [{ item: 'ENT', note: '', answers: [{ q: 'Triggers', a: 'Cold' }] }, { item: 'Ortho', note: '' }]);
});
