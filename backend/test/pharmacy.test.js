// Pharmacy formulas shared by the screens and the server: Purchase / Order, Stock In and Sales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLine, discOf, linkPrice, orderTotals, pRateOf, roundOffOf, splitGst } from '../../shared/purchase.js';
import { packSize, selAmount, unitPrice } from '../../shared/stockin.js';
import { lineAmount, lineCost, packsOf, perSaleUnit, saleTotals } from '../../shared/sale.js';

test('Purchase line: Amount = Qty × P.Rate, Disc % worked out from MRP, free units not charged', () => {
  const c = calcLine({ mrp: 100, p_rate: 90, disc_percent: 99, qty: 5, free_qty: 1, cgst_percent: 6, sgst_percent: 6 });
  assert.deepEqual(c, { disc_percent: 10, rate: 90, amount: 450, gst_percent: 12, gst_amount: 54, total: 504 });
  assert.equal(calcLine({ mrp: 0, p_rate: 50, qty: 1 }).disc_percent, 0);
});

test('MRP, Disc % and P.Rate are linked', () => {
  assert.equal(pRateOf(100, 10), 90);
  assert.equal(discOf(100, 90), 10);
  assert.equal(pRateOf(32.12, 5), 30.51);
  const line = { mrp: 100, disc_percent: 10, p_rate: 90 };
  assert.deepEqual(linkPrice(line, { disc_percent: 20 }), { mrp: 100, disc_percent: 20, p_rate: 80 });   // Disc % → P.Rate
  assert.deepEqual(linkPrice(line, { p_rate: 75 }), { mrp: 100, disc_percent: 25, p_rate: 75 });        // P.Rate → Disc %
  assert.deepEqual(linkPrice(line, { mrp: 200 }), { mrp: 200, disc_percent: 10, p_rate: 180 });         // MRP → P.Rate
  assert.deepEqual(linkPrice({ mrp: 100, disc_percent: '', p_rate: 80 }, { mrp: 160 }), { mrp: 160, disc_percent: 50, p_rate: 80 });
  assert.deepEqual(linkPrice({ mrp: '', disc_percent: '', p_rate: '' }, { p_rate: 40 }), { mrp: '', disc_percent: '', p_rate: 40 });
});

test('GST % splits evenly into CGST % and SGST %', () => {
  assert.deepEqual(splitGst(12), { cgst_percent: 6, sgst_percent: 6 });
  assert.deepEqual(splitGst(5), { cgst_percent: 2.5, sgst_percent: 2.5 });
});

test('Stock In: Sel.Amount = MRP less S.Disc %, Unit Price per piece', () => {
  assert.equal(selAmount({ mrp: 32.12, disc_percent: 5 }), 30.51);
  assert.equal(unitPrice(30.51, '15'), 2.03);
  assert.equal(packSize('15'), 15);
  assert.equal(packSize('ML'), 1);
  assert.equal(packSize(''), 1);
});

test('Sales: unit sales take a part of a pack; amount less Disc %; bill discount', () => {
  assert.equal(packsOf({ qty: 5, sale_unit: 'unit', pack_size: 15 }), 0.3333);
  assert.equal(packsOf({ qty: 2, sale_unit: 'pack', pack_size: 15 }), 2);
  assert.equal(perSaleUnit(30, 'unit', 15), 2);
  assert.equal(lineAmount({ qty: 2, price: 50, disc_percent: 10 }), 90);
  assert.equal(lineCost({ qty: 5, sale_unit: 'unit', pack_size: 15, cost: 24 }), 8);
  const s = saleTotals([
    { qty: 2, price: 50, disc_percent: 10, sale_unit: 'pack', pack_size: 1, cost: 40 },
    { qty: 1, price: 20, sale_unit: 'pack', pack_size: 1, cost: 15 },
  ], 10);
  assert.deepEqual(s, { sub_total: 110, discount_amount: 11, total_amount: 99, cost: 95 });
});

test('Round Off = round(total) − total', () => {
  assert.equal(roundOffOf(99.75), 0.25);
  assert.equal(roundOffOf(24.25), -0.25);
  assert.equal(roundOffOf(24.5), 0.5);
});

test('Order footer: whole-bill discount comes off before Round Off', () => {
  assert.deepEqual(orderTotals(268.8, 0, true), { sum: 268.8, disc_amount: 0, round_off: 0.2, total: 269 });
  assert.deepEqual(orderTotals(268.8, 10, true), { sum: 268.8, disc_amount: 26.88, round_off: 0.08, total: 242 });
  assert.deepEqual(orderTotals(268.8, 10, false), { sum: 268.8, disc_amount: 26.88, round_off: 0, total: 241.92 });
});
