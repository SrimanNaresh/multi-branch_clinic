// Vital-sign rules (shared by UI and API):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { bmi, checkVitals } from '../../shared/vitals.js';

const full = { height_cm: '170', weight_kg: '65.5', bp_systolic: '120', bp_diastolic: '80', pulse_bpm: '72', temperature_c: '36.8', comments: ' fasting ' };

test('valid vitals are converted to numbers', () => {
  const { data, errors } = checkVitals(full);
  assert.deepEqual(errors, {});
  assert.deepEqual(data, { height_cm: 170, weight_kg: 65.5, bp_systolic: 120, bp_diastolic: 80, pulse_bpm: 72, temperature_c: 36.8, comments: 'fasting' });
  assert.equal(bmi(data), 22.7);
});

test('every field is optional, but not all of them together', () => {
  assert.deepEqual(checkVitals({ pulse_bpm: 80 }).errors, {});
  assert.deepEqual(checkVitals({ comments: 'patient refused' }).errors, {});
  assert.equal(checkVitals({}).errors._form, 'empty');
});

test('ranges, decimals and numbers are checked', () => {
  assert.equal(checkVitals({ ...full, temperature_c: '98.6' }).errors.temperature_c, 'range'); // °F typed by mistake
  assert.equal(checkVitals({ ...full, height_cm: '17' }).errors.height_cm, 'range');
  assert.equal(checkVitals({ ...full, pulse_bpm: '72.5' }).errors.pulse_bpm, 'decimals');
  assert.equal(checkVitals({ ...full, weight_kg: 'abc' }).errors.weight_kg, 'number');
});

test('blood pressure needs both values, diastolic below systolic', () => {
  assert.equal(checkVitals({ ...full, bp_diastolic: '' }).errors.bp_diastolic, 'bpBoth');
  assert.equal(checkVitals({ ...full, bp_systolic: '' }).errors.bp_systolic, 'bpBoth');
  assert.equal(checkVitals({ ...full, bp_diastolic: '120' }).errors.bp_diastolic, 'bpOrder');
});
