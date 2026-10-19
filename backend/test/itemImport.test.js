// Item template / import rules (shared by UI and API):  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_COLUMNS, checkItemRows, parseCsv, rowsFromCsv, templateCsv } from '../../shared/itemImport.js';

test('the template has every form field and parses back', () => {
  const csv = templateCsv();
  assert.ok(csv.startsWith('﻿'));                      // Excel reads it as UTF-8
  const { rows, missing, unknown } = rowsFromCsv(csv);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
  assert.equal(rows.length, 1);
  assert.equal(Object.keys(rows[0].data).length, ITEM_COLUMNS.length);
  assert.deepEqual(checkItemRows(rows)[0].errors, []);
});

test('CSV cells may contain commas, quotes and line breaks', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4\r\n'), [['a', 'b, c', 'say "hi"', 'x\ny'], ['1', '2', '3', '4']]);
  assert.deepEqual(parseCsv('a,b\n\n,\n1,2'), [['a', 'b'], ['1', '2']]);   // blank lines skipped
});

test('columns are matched by header in any order; missing Item Name is reported', () => {
  const { rows } = rowsFromCsv('mrp,ITEM NAME*,unit\n10,Nux Vomica,bottle\n');
  assert.deepEqual(rows[0], { line: 2, data: { mrp: '10', name: 'Nux Vomica', unit: 'bottle' } });
  assert.deepEqual(rowsFromCsv('Category\nTablet\n').missing, ['Item Name']);
});

test('row rules match the form', () => {
  const rows = [
    { line: 2, data: { name: 'A', mrp: '50', price: '60' } },
    { line: 3, data: { name: '', gst_percent: '40' } },
    { line: 4, data: { name: 'B', discount_percent: '-1', schedule_h: 'maybe', hsn_code: '30-04' } },
    { line: 5, data: { name: 'C', schedule_h: 'Y', schedule_h1: 'no', purchase_rate: '' } },
    { line: 6, data: { name: 'c', unit: '' } },                         // same as C + default unit nos
  ];
  const codes = checkItemRows(rows).map((r) => r.errors.map((e) => e.code));
  assert.deepEqual(codes, [['mrp'], ['name', 'gst'], ['number', 'yesNo', 'hsn'], [], ['duplicate']]);
  const ok = checkItemRows(rows)[3].data;
  assert.equal(ok.schedule_h, 1);
  assert.equal(ok.schedule_h1, 0);
  assert.equal(ok.unit, 'nos');
  assert.equal(ok.purchase_rate, 0);
});

test('files re-saved by Excel still import', async () => {
  const { decodeFile } = await import('../../shared/itemImport.js');
  // semicolon separator (some regional settings)
  let r = rowsFromCsv('Item Name;Unit;MRP\r\nNux Vomica;bottle;95\r\n');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.rows[0].data, { name: 'Nux Vomica', unit: 'bottle', mrp: '95' });
  // "Unicode Text": UTF-16LE with BOM, tab separated
  const text = '\uFEFFItem Name\tUnit\r\nArnica\tbottle\r\n';
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { bytes[i * 2] = text.charCodeAt(i) & 255; bytes[i * 2 + 1] = text.charCodeAt(i) >> 8; }
  r = rowsFromCsv(decodeFile(bytes.buffer));
  assert.deepEqual(r.missing, []);
  assert.equal(r.rows[0].data.name, 'Arnica');
  // a title row and a blank row above the headings; non-breaking space in a heading
  r = rowsFromCsv('Clinic A stock list,,\r\n,,\r\nItem\u00A0Name,Unit,MRP\r\nBelladonna,bottle,80\r\n');
  assert.deepEqual(r.missing, []);
  assert.equal(r.rows[0].data.name, 'Belladonna');
  assert.equal(r.rows[0].line, 3);
  // still missing → the headings that were found are reported
  r = rowsFromCsv('Product,Qty\r\nX,1\r\n');
  assert.deepEqual(r.missing, ['Item Name']);
  assert.deepEqual(r.found, ['Product', 'Qty']);
});
