// Scan Bill (Three in One): column placing and the price rules for one bill line (frontend/src/lib/billColumns.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoMap, fieldsOf, monthIn, packSizeOf } from '../../frontend/src/lib/billColumns.js';
import { parseItemLine } from '../../frontend/src/lib/billScan.js';

test('Clear bill headings are placed on the Three in One columns', () => {
  const heads = ['Item Description', 'Batch', 'Exp', 'Qty', 'Free', 'MRP', 'Rate', 'Disc', 'GST %'].map((label) => ({ label }));
  heads[0].field = 'name'; heads[1].field = 'category'; heads[3].field = 'qty'; heads[5].field = 'mrp';
  assert.deepEqual(autoMap({ heads, rows: [] }),
    { name: 0, batch: 1, exp: 2, qty: 3, free: 4, mrp: 5, pRate: 6, disc: 7, gst: 8 });
});

test('Disc % is a % of the MRP; an amount is turned into a %', () => {
  assert.equal(fieldsOf(['A', '100', '90', '10', '2'], { name: 0, mrp: 1, pRate: 2, disc: 3, qty: 4 }).disc, '10');
  // MRP 200 − 10 = Rate 190 → the 10 is an amount: 5 %
  assert.equal(fieldsOf(['A', '200', '190', '10'], { name: 0, mrp: 1, pRate: 2, disc: 3 }).disc, '5');
  // a Disc above 100 is an amount: 150 of MRP 1000 → 15 %
  assert.equal(fieldsOf(['A', '1000', '150', '1'], { name: 0, mrp: 1, disc: 2, qty: 3 }).disc, '15');
});

test('No rate column: Amount ÷ Qty is the rate', () => {
  const o = fieldsOf(['A', '100', '2', '160'], { name: 0, mrp: 1, qty: 2, amount: 3 });
  assert.equal(o.pRate, '80');
  assert.equal(o.amount, undefined);   // Amount itself is worked out again on the screen
});

test('No GST % column: from "9%+9%", CGST + SGST, GST Amt or Total', () => {
  assert.equal(fieldsOf(['A', '9%+9%'], { name: 0, gst: 1 }).gst, '18');
  assert.equal(fieldsOf(['A', '6', '6'], { name: 0, cgst: 1, sgst: 2 }).gst, '12');
  assert.equal(fieldsOf(['A', '2', '50', '100', '12'], { name: 0, qty: 1, pRate: 2, amount: 3, gstAmt: 4 }).gst, '12');
  assert.equal(fieldsOf(['A', '2', '50', '100', '105'], { name: 0, qty: 1, pRate: 2, amount: 3, total: 4 }).gst, '5');
});

test('Bill months as YYYY-MM', () => {
  assert.equal(monthIn('02/28'), '2028-02');
  assert.equal(monthIn('MAY-27'), '2027-05');
  assert.equal(monthIn('31/05/2027'), '2027-05');
  assert.equal(monthIn('0527'), '2027-05');
  assert.equal(monthIn('13/27'), '');
});

test("Pack text \"10's\" / \"1x15\" gives the pack size", () => {
  assert.equal(parseItemLine("ARNICA MONTANA 30 10's 2 85.00 170.00").pack, "10'S");
  assert.equal(packSizeOf("10'S"), '10');
  assert.equal(packSizeOf('15S'), '15');
  assert.equal(packSizeOf('1x15'), '15');
  assert.equal(packSizeOf('10*10'), '10');
  assert.equal(packSizeOf('STRIP'), '');
});
