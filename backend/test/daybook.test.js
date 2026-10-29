// Day Book day-wise chart rules (shared by the Examine screen and the printout):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartDays, cleanChartDays, daysFromFrequency, defaultChartDays, frequencyPlan } from '../../shared/daybook.js';

test('frequency decides the times of day and how often a day is due', () => {
  assert.deepEqual(frequencyPlan('Daily'), { slots: ['once'], every: 1 });
  assert.deepEqual(frequencyPlan(''), { slots: ['once'], every: 1 });
  assert.deepEqual(frequencyPlan('Twice a day'), { slots: ['morning', 'evening'], every: 1 });
  assert.deepEqual(frequencyPlan('TDS'), { slots: ['morning', 'afternoon', 'evening'], every: 1 });
  assert.deepEqual(frequencyPlan('Weekly'), { slots: ['once'], every: 7 });
  assert.deepEqual(frequencyPlan('Alternate days'), { slots: ['once'], every: 2 });
  assert.deepEqual(frequencyPlan('Every Day 5'), { slots: ['once'], every: 1 });
});

test('a Frequency that is just a number is the number of days', () => {
  assert.equal(daysFromFrequency('5'), 5);
  assert.equal(daysFromFrequency('10 days'), 10);
  assert.equal(daysFromFrequency('Twice a day'), null);
  assert.equal(daysFromFrequency('2 times'), null);
  assert.equal(daysFromFrequency('500'), null);
  assert.equal(defaultChartDays('2026-10-27', '2026-11-10', '5'), 5);
});

test('chart runs to the follow-up date, else 7 days; typed days are 1–90', () => {
  assert.equal(defaultChartDays('2026-10-27', '2026-11-10'), 14);
  assert.equal(defaultChartDays('2026-10-27', ''), 7);
  assert.equal(defaultChartDays('2026-10-27', '2026-10-20'), 7);
  assert.equal(defaultChartDays('2026-01-01', '2026-12-31'), 90);
  assert.equal(cleanChartDays('10'), 10);
  assert.equal(cleanChartDays('0', 7), 7);
  assert.equal(cleanChartDays('abc', 5), 5);
});

test('chart days: one per day from the start, every n-th day due', () => {
  const days = chartDays('2026-10-30', 3, 2);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(days.map((d) => d.due), [true, false, true]);
  assert.equal(days[0].weekday, 5);   // Friday
  assert.deepEqual(chartDays('', 3), []);
});

test('typed chart boxes: only filled ones with a date key are kept', async () => {
  const { chartCellKey, cleanChartValues } = await import('../../shared/daybook.js');
  assert.equal(chartCellKey('2026-10-27', 'Walking', 'once'), '2026-10-27|Walking|once');
  assert.equal(chartCellKey('2026-10-27', 'remarks'), '2026-10-27|remarks');
  assert.deepEqual(cleanChartValues({ '2026-10-27|Walking|once': ' 20  min ', '2026-10-28|Yoga|once': '  ', bad: 'x' }),
    { '2026-10-27|Walking|once': '20 min' });
  assert.deepEqual(cleanChartValues(null), {});
  assert.deepEqual(cleanChartValues(['x']), {});
});
