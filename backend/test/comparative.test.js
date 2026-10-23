// Examine → Complaints & diagnosis → Comparative Study:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkComparative, MAX_READING, sortComparative } from '../../shared/comparative.js';

test('a row needs a real date and Rt.H or Lt.H; Time is short text', () => {
  assert.deepEqual(checkComparative({ study_date: '2026-10-23', study_time: '09:30', rt_h: ' 120 ', lt_h: '' }),
    { row: { study_date: '2026-10-23', study_time: '09:30', rt_h: '120', lt_h: null } });
  assert.deepEqual(checkComparative({ study_date: '2026-10-23', lt_h: 'Normal' }),
    { row: { study_date: '2026-10-23', study_time: null, rt_h: null, lt_h: 'Normal' } });
  assert.deepEqual(checkComparative({ study_date: '', rt_h: '1' }), { error: 'date' });
  assert.deepEqual(checkComparative({ study_date: '2026-02-30', rt_h: '1' }), { error: 'date' });
  assert.equal(checkComparative({ study_date: '2026-10-23', study_time: ' 10:30  am ', rt_h: '1' }).row.study_time, '10:30 am');
  assert.equal(checkComparative({ study_date: '2026-10-23', study_time: 't'.repeat(40), rt_h: '1' }).row.study_time.length, 20);
  assert.deepEqual(checkComparative({ study_date: '2026-10-23', rt_h: '  ', lt_h: '' }), { error: 'reading' });
  assert.equal(checkComparative({ study_date: '2026-10-23', rt_h: 'x'.repeat(150) }).row.rt_h.length, MAX_READING);
});

test('rows read oldest first: date, then time, then id', () => {
  const rows = [
    { id: 3, study_date: '2026-10-23', study_time: '10:00' },
    { id: 1, study_date: '2026-10-20', study_time: null },
    { id: 2, study_date: '2026-10-23', study_time: '09:00' },
  ];
  assert.deepEqual(sortComparative(rows).map((r) => r.id), [1, 2, 3]);
});
