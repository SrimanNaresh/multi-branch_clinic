// Doctor time-slot rules (shared by UI and API):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCount, checkTimeSlots } from '../../shared/timeSlots.js';

const ok = { start_time: '09:00', end_time: '13:00', slot_minutes: 15, break_start: '11:00', break_end: '11:30' };
const codes = (rows) => checkTimeSlots(rows).errors.map((e) => `${e.row}:${e.code}`);

test('a slot with a break inside start–end is valid', () => {
  assert.deepEqual(codes([ok]), []);
  assert.equal(appointmentCount(ok), 14); // 8 before the break + 6 after
  assert.deepEqual(codes([{ ...ok, break_start: '', break_end: '' }]), []);
});

test('the break must lie between start and end time', () => {
  assert.deepEqual(codes([{ ...ok, break_start: '08:30' }]), ['0:breakInside']);
  assert.deepEqual(codes([{ ...ok, break_end: '13:30' }]), ['0:breakInside']);
  assert.deepEqual(codes([{ ...ok, break_start: '11:30', break_end: '11:00' }]), ['0:breakOrder']);
  assert.deepEqual(codes([{ ...ok, break_end: '' }]), ['0:breakBoth']);
});

test('start, end and duration are checked', () => {
  assert.deepEqual(codes([{ ...ok, end_time: '08:00' }]), ['0:order']);
  assert.deepEqual(codes([{ ...ok, start_time: '' }]), ['0:start']);
  assert.deepEqual(codes([{ ...ok, slot_minutes: 2 }]), ['0:duration']);
  assert.deepEqual(codes([{ ...ok, slot_minutes: 240 }]), ['0:durationFit']);
});

test('several slots are allowed but must not overlap', () => {
  const evening = { start_time: '14:00', end_time: '17:00', slot_minutes: 20 };
  assert.deepEqual(codes([ok, evening]), []);
  assert.deepEqual(codes([ok, { ...evening, start_time: '12:00' }]), ['1:overlap']);
  assert.equal(checkTimeSlots([ok, evening]).slots[1].break_start, null);
});
