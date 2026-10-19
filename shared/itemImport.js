// Pharmacy → Item: CSV template + import.
// The same column list and row rules are used by the UI (preview) and the API (before saving).

// key = items field (supplier_name is resolved to a supplier on the server)
export const ITEM_COLUMNS = [
  { key: 'name', header: 'Item Name', required: true },
  { key: 'item_type', header: 'Item Type' },
  { key: 'category', header: 'Category' },
  { key: 'hsn_code', header: 'HSN Code' },
  { key: 'manufacturer', header: 'Manufacturer' },
  { key: 'supplier_name', header: 'Supplier' },
  { key: 'generic_name', header: 'Generic Name' },
  { key: 'brand_name', header: 'Tablet Name' },
  { key: 'unit', header: 'Unit' },
  { key: 'purchase_rate', header: 'Purchase Rate', number: true },
  { key: 'gst_percent', header: 'GST %', number: true },
  { key: 'mrp', header: 'MRP', number: true },
  { key: 'price', header: 'Sell Price', number: true },
  { key: 'discount_percent', header: 'Discount %', number: true },
  { key: 'schedule_h', header: 'Schedule H', yesNo: true },
  { key: 'schedule_h1', header: 'Schedule H1', yesNo: true },
];
export const MAX_IMPORT_ROWS = 1000;

// English messages; the UI shows its own translation of each code (itemImport.err.<code>).
export const IMPORT_ERRORS = {
  name: 'Item Name is required',
  number: 'must be a number (0 or more)',
  gst: 'GST % must be 0–28',
  discount: 'Discount % must be 0–100',
  mrp: 'Sell Price cannot be more than MRP',
  hsn: 'HSN Code: letters and digits only',
  yesNo: 'use Y or N',
  long: 'is too long',
  duplicate: 'same Item Name and Unit appears earlier in the file',
};
const MAX_LEN = { name: 200, item_type: 50, category: 100, hsn_code: 20, manufacturer: 150, supplier_name: 150, generic_name: 150, brand_name: 150, unit: 30 };

const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Template file: header row + one example row (delete it before importing). Excel opens it directly. */
export function templateCsv() {
  const example = ['Arnica Montana 30C', 'Medicine', 'Dilution', '3004', 'SBL', 'Sri Ram Agencies', 'Arnica Montana', 'Arnica 30', 'bottle', '60.00', '12', '95.00', '90.00', '0', 'N', 'N'];
  return '﻿' + [ITEM_COLUMNS.map((c) => c.header), example].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The column separator Excel used: comma, semicolon (some regional settings) or tab ("Text" files). */
export function detectDelimiter(text) {
  const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC-4180 style CSV → array of rows (handles quotes, separators and line breaks inside quotes). */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// header text → comparable form: ignores BOM / zero-width / non-breaking spaces, "*", "%", "_" and case
const norm = (h) => String(h).replace(/[\uFEFF\u200B-\u200D\u00A0]/g, ' ').toLowerCase()
  .replace(/[*%_]/g, ' ').replace(/\s+/g, ' ').trim();
const matchColumn = (h) => ITEM_COLUMNS.find((c) => norm(c.header) === norm(h) || norm(c.key) === norm(h));

/**
 * CSV text → { rows: [{ line, data }], missing: [headers], unknown: [headers], found: [headers] }.
 * Columns are matched by header name (any order, case-insensitive, "*" ignored). The header row is the
 * first of the top 10 rows that has an "Item Name" column, so a title row above it is fine.
 */
export function rowsFromCsv(text) {
  const table = parseCsv(text);
  const required = ITEM_COLUMNS.filter((c) => c.required);
  if (!table.length) return { rows: [], missing: required.map((c) => c.header), unknown: [], found: [] };
  let headAt = table.slice(0, 10).findIndex((r) => required.every((c) => r.some((h) => matchColumn(h)?.key === c.key)));
  if (headAt < 0) headAt = 0;
  const head = table[headAt];
  const index = {};
  const unknown = [];
  head.forEach((h, i) => {
    const col = matchColumn(h);
    if (col && index[col.key] === undefined) index[col.key] = i; else if (!col && h.trim()) unknown.push(h.trim());
  });
  const missing = required.filter((c) => index[c.key] === undefined).map((c) => c.header);
  const rows = table.slice(headAt + 1).map((cells, n) => ({
    line: headAt + n + 2,                          // row number as Excel shows it (blank rows aside)
    data: Object.fromEntries(ITEM_COLUMNS.filter((c) => index[c.key] !== undefined).map((c) => [c.key, (cells[index[c.key]] ?? '').trim()])),
  }));
  return { rows, missing, unknown, found: head.map((h) => h.trim()).filter(Boolean) };
}

/** File bytes → text: UTF-16 ("Unicode Text" from Excel) or UTF-8. */
export function decodeFile(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
  // no BOM, but every other byte is 0 → UTF-16LE without a BOM
  if (b.length > 3 && b[1] === 0 && b[3] === 0 && b[0] !== 0) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

/**
 * Checks one row and returns { data, errors: [{ field, code }] }.
 * data is ready to save: numbers as numbers, Y/N as 1/0, empty text as null, unit defaults to "nos".
 */
export function checkItemRow(input) {
  const errors = [];
  const data = {};
  for (const c of ITEM_COLUMNS) {
    const raw = input[c.key];
    const v = raw == null ? '' : String(raw).trim();
    if (c.number) {
      const n = v === '' ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0) errors.push({ field: c.key, code: 'number' });
      data[c.key] = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    } else if (c.yesNo) {
      if (v === '' || /^(n|no|0|false)$/i.test(v)) data[c.key] = 0;
      else if (/^(y|yes|1|true)$/i.test(v)) data[c.key] = 1;
      else { errors.push({ field: c.key, code: 'yesNo' }); data[c.key] = 0; }
    } else {
      if (v.length > MAX_LEN[c.key]) errors.push({ field: c.key, code: 'long' });
      data[c.key] = v === '' ? null : v.slice(0, MAX_LEN[c.key]);
    }
  }
  if (!data.name) errors.push({ field: 'name', code: 'name' });
  data.unit = data.unit || 'nos';
  if (data.gst_percent > 28) errors.push({ field: 'gst_percent', code: 'gst' });
  if (data.discount_percent > 100) errors.push({ field: 'discount_percent', code: 'discount' });
  if (data.mrp > 0 && data.price > data.mrp) errors.push({ field: 'price', code: 'mrp' });
  if (data.hsn_code && !/^[0-9A-Za-z]{2,20}$/.test(data.hsn_code)) errors.push({ field: 'hsn_code', code: 'hsn' });
  return { data, errors };
}

/** Checks every row, including repeats of the same name + unit inside the file. */
export function checkItemRows(rows) {
  const seen = new Set();
  return rows.map((r) => {
    const { data, errors } = checkItemRow(r.data);
    const key = `${(data.name || '').toLowerCase()}|${data.unit.toLowerCase()}`;
    if (data.name && seen.has(key)) errors.push({ field: 'name', code: 'duplicate' });
    seen.add(key);
    return { line: r.line, data, errors };
  });
}
