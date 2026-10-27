// Vital-sign rules (shared by UI and API):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { bmi, checkVitals } from '../../shared/vitals.js';

const full = { height_cm: '170', weight_kg: '65.5', bp_systolic: '120', bp_diastolic: '80', pulse_bpm: '72', temperature_f: '98.4', comments: ' fasting ' };

test('valid vitals are converted to numbers', () => {
  const { data, errors } = checkVitals(full);
  assert.deepEqual(errors, {});
  assert.deepEqual(data, { height_cm: 170, weight_kg: 65.5, bp_systolic: 120, bp_diastolic: 80, bp_r_systolic: null, bp_r_diastolic: null, pulse_bpm: 72, temperature_f: 98.4, sugar_type: null, sugar_value: null, comments: 'fasting' });
  assert.equal(bmi(data), 22.7);
});

test('blood sugar: a test from the list and its value, checked against that test', () => {
  assert.deepEqual(checkVitals({ sugar_type: 'FBS', sugar_value: '95' }).data.sugar_value, 95);
  assert.deepEqual(checkVitals({ sugar_type: 'HbA1c', sugar_value: '6.5' }).errors, {});
  assert.equal(checkVitals({ sugar_type: 'PPBS', sugar_value: '700' }).errors.sugar_value, 'range');
  assert.equal(checkVitals({ sugar_type: 'RBS', sugar_value: '120.5' }).errors.sugar_value, 'decimals');
  assert.equal(checkVitals({ sugar_type: 'HbA1c', sugar_value: '25' }).errors.sugar_value, 'range');
  assert.equal(checkVitals({ sugar_value: '95' }).errors.sugar_type, 'sugarType');
  assert.equal(checkVitals({ sugar_type: 'XYZ', sugar_value: '95' }).errors.sugar_type, 'sugarType');
  assert.equal(checkVitals({ sugar_type: 'FBS' }).errors.sugar_value, 'sugarEmpty');
});

test('right-arm blood pressure follows the same rules as the left', () => {
  assert.deepEqual(checkVitals({ ...full, bp_r_systolic: '118', bp_r_diastolic: '78' }).errors, {});
  assert.equal(checkVitals({ ...full, bp_r_systolic: '118' }).errors.bp_r_diastolic, 'bpBoth');
  assert.equal(checkVitals({ ...full, bp_r_systolic: '80', bp_r_diastolic: '90' }).errors.bp_r_diastolic, 'bpOrder');
  assert.deepEqual(checkVitals({ bp_r_systolic: '118', bp_r_diastolic: '78' }).errors, {});
});

test('every field is optional, but not all of them together', () => {
  assert.deepEqual(checkVitals({ pulse_bpm: 80 }).errors, {});
  assert.deepEqual(checkVitals({ comments: 'patient refused' }).errors, {});
  assert.equal(checkVitals({}).errors._form, 'empty');
});

test('ranges, decimals and numbers are checked', () => {
  assert.equal(checkVitals({ ...full, temperature_f: '37' }).errors.temperature_f, 'range'); // °C typed by mistake
  assert.equal(checkVitals({ ...full, height_cm: '17' }).errors.height_cm, 'range');
  assert.equal(checkVitals({ ...full, pulse_bpm: '72.5' }).errors.pulse_bpm, 'decimals');
  assert.equal(checkVitals({ ...full, weight_kg: 'abc' }).errors.weight_kg, 'number');
});

test('blood pressure needs both values, diastolic below systolic', () => {
  assert.equal(checkVitals({ ...full, bp_diastolic: '' }).errors.bp_diastolic, 'bpBoth');
  assert.equal(checkVitals({ ...full, bp_systolic: '' }).errors.bp_systolic, 'bpBoth');
  assert.equal(checkVitals({ ...full, bp_diastolic: '120' }).errors.bp_diastolic, 'bpOrder');
});
