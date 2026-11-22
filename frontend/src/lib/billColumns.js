// Scan Bill → Match columns: the Three in One columns (tiles), placing them on the bill's headings, and turning
// one bill line into Three in One fields (Disc % of MRP, P.Rate from Amount ÷ Qty, GST % from CGST + SGST …).
// Pure functions (no React / OCR) so they can be tested in Node (backend/test/billScan.test.js).
// Moved unchanged from components/ScanBillModal.jsx (originally from Ayush All In One).

// The Three in One columns as tiles: [key, heading], grouped Item · Purchase / Order · Stock In.
export const TARGETS = [
  ['name', 'Item Name'], ['generic', 'Generic'], ['manufacturer', 'Manufacturer'], ['hsnCode', 'HSN'],
  ['category', 'Category'], ['pack', 'Pack'], ['unit', 'Unit'], ['rack', 'Rack'],
  ['mrp', 'MRP'], ['oldPrice', 'Old Price'], ['disc', 'Disc%'], ['pRate', 'P.Rate'],
  ['qty', 'Qty'], ['free', 'Free'], ['amount', 'Amount'],
  ['gst', 'GST%'], ['cgst', 'CGST%'], ['sgst', 'SGST%'], ['gstAmt', 'GST Amt'], ['total', 'Total'],
  ['batch', 'Batch No'], ['mfg', 'Mf.Date'], ['exp', 'Exp.Date'], ['sDisc', 'S.Disc%'], ['sel', 'Sel.Amount'],
];
const NUMERIC = new Set(['mrp', 'pRate', 'free', 'disc', 'qty', 'gst', 'sDisc', 'sel']);
const DERIVE_ONLY = ['oldPrice', 'amount', 'gstAmt', 'total', 'cgst', 'sgst'];
const headKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
// A bill heading the reader didn't name, by its words: "Rate" → P.Rate, "GST %" → GST% …
const BY_LABEL = [
  ['cgst', (k) => k.startsWith('cgst') && !/amt|amount|value/.test(k)],
  ['sgst', (k) => k.startsWith('sgst') && !/amt|amount|value/.test(k)],
  ['gst', (k) => /^(gst|igst|tax)/.test(k) && !/amt|amount|value|able/.test(k)],
  ['free', (k) => k.startsWith('free') || k === 'fr'],
  ['disc', (k) => /^(disc|dis|discount|cd|sch)/.test(k) && !/amt|amount/.test(k)],
  ['oldPrice', (k) => /^(netrate|nrate|netprice|effrate)$/.test(k)],
  ['pRate', (k) => /^(rate|prate|ptr|pts|purrate|purchaserate|price)$/.test(k)],
  ['gstAmt', (k) => /^(gst|igst|tax)(amt|amount|value)$/.test(k)],
  ['amount', (k) => /^(amt|amount|value|taxable|taxablevalue|taxableamt|grossamt|grossamount)$/.test(k)],
  ['total', (k) => /^(total|netamt|netamount|nettotal|totalamt|totalamount)$/.test(k)],
  ['unit', (k) => /^(unit|uom|type)$/.test(k)],
  ['generic', (k) => /^(generic|genericname|composition|content)$/.test(k)],
  ['batch', (k) => /^(batch|batchno|bno|lot|lotno)$/.test(k)],
  ['sDisc', (k) => /^(sdisc|salesdisc|saledisc|sellingdisc)$/.test(k)],
  ['sel', (k) => /^(selamount|sellingprice|saleprice|salerate|sp|srate)$/.test(k)],
  ['exp', (k) => /^(exp|expy|expiry|expire|expires|expd|ed)(date|dt|on|mmyy|month)?$/.test(k) || k === 'expirydt'],
  ['mfg', (k) => /^(mfg|mfd|mf|md|mfgd|manufacturing|manufactured|manuf)(date|dt|on|mmyy|month)$/.test(k) || /^(mfd|md)$/.test(k)],
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A bill's month as 'YYYY-MM', or '' (2/28, 12/2027, 0527, MAY-27, 31/05/2027 …) */
export function monthIn(text) {
  const t = String(text || '').toUpperCase().replace(/(?<=\d)O|O(?=\d)/g, '0').trim();
  const out = (mm, yy) => {
    const mo = Number(mm);
    if (!(mo >= 1 && mo <= 12)) return '';
    const y = String(yy).length === 2 ? `20${yy}` : String(yy);
    return /^20\d{2}$/.test(y) ? `${y}-${String(mo).padStart(2, '0')}` : '';
  };
  let m = /(?:^|\D)\d{1,2}\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return out(m[1], m[2]);
  m = /([A-Z]{3})[A-Z]*\.?\s*[-/.,']?\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m && MONTHS.includes(m[1])) return out(MONTHS.indexOf(m[1]) + 1, m[2]);
  m = /(?:^|\D)(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return out(m[1], m[2]);
  m = /^(\d{2})(\d{4}|\d{2})$/.exec(t.replace(/\s/g, ''));
  return m ? out(m[1], m[2]) : '';
}
export const numIn = (t, last = false) => {
  const s = String(t || '').replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').replace(/,/g, '');
  const all = s.match(/\d+(\.\d+)?/g);
  return all ? String(Number(all[last ? all.length - 1 : 0])) : '';
};
export function valueFor(key, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (key === 'exp' || key === 'mfg') return monthIn(t);
  if (key === 'mrp') return numIn(t, true);
  if (NUMERIC.has(key) || DERIVE_ONLY.includes(key)) return numIn(t);
  if (key === 'hsnCode') return t.replace(/[oO]/g, '0').replace(/\D/g, '').slice(0, 20);
  if (key === 'category' || key === 'batch') return t.replace(/ /g, '').toUpperCase().slice(0, key === 'batch' ? 50 : 100);
  const max = { name: 200, manufacturer: 150, generic: 150, pack: 50, unit: 30, rack: 50 }[key] || 100;
  // a serial number read into the MFR cell ("1 SBL") is not part of the manufacturer
  const v = key === 'manufacturer' ? t.replace(/^\d{1,3}[.)]?\s+(?=\D)/, '') : t;
  return v.toUpperCase().slice(0, max);
}
/** The bill's Disc as a % of MRP: printed as a % or as an amount (per unit or for the line) */
export function discPercent(text, o) {
  const t = String(text || '');
  const num = numIn(t);
  if (num === '') return '';
  const v = Number(num);
  const mrp = Number(o.mrp) || 0;
  const rate = Number(o.pRate) || 0;
  const qty = Number(o.qty) || 0;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.01);
  const pct = (x) => (x >= 0 && x <= 100 ? String(Math.round(x * 100) / 100) : '');
  if (/%/.test(t)) return pct(v);
  if (mrp > 0 && rate > 0) {
    if (near(mrp * (1 - v / 100), rate)) return pct(v);
    if (near(mrp - v, rate)) return pct((v / mrp) * 100);
    if (qty > 0 && near(mrp * qty - v, rate * qty)) return pct((v / (mrp * qty)) * 100);
  }
  if (v <= 100) return pct(v);
  if (!mrp) return '';
  if (v < mrp) return pct((v / mrp) * 100);
  return qty > 0 ? pct((v / (mrp * qty)) * 100) : '';
}
const TAX_PAIR = /^(\d+(?:\.\d+)?)\s*%?\s*[-+]*\+[-+]*\s*(\d+(?:\.\d+)?)\s*%?$/;
export const taxPair = (text) => {
  const m = TAX_PAIR.exec(String(text || '').replace(/\s+/g, ' ').trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** One bill line through the column matches → its fields (P.Rate / GST % worked out when the bill has none) */
export function fieldsOf(cells, map) {
  const o = {};
  for (const [key] of TARGETS) if (map[key] != null) o[key] = valueFor(key, cells[map[key]]);
  if (o.disc != null) o.disc = discPercent(cells[map.disc], o);
  const r2 = (n) => String(Math.round(n * 100) / 100);
  const n = (k) => Number(o[k]) || 0;
  for (const k of ['gst', 'cgst', 'sgst']) {
    const pair = map[k] != null ? taxPair(cells[map[k]]) : null;
    if (!pair) continue;
    if (k === 'gst') { o.gst = r2(pair[0] + pair[1]); continue; }
    if (k === 'cgst' || map.cgst == null) o.cgst = r2(pair[0]);
    if (k === 'sgst' || map.sgst == null) o.sgst = r2(pair[1]);
  }
  if (!(n('pRate') > 0)) {
    const net = n('amount') > 0 && n('qty') > 0 ? n('amount') / n('qty') : n('oldPrice');
    if (net > 0) o.pRate = r2(net);
  }
  if (!o.gst) {
    const amt = n('amount') || n('qty') * n('oldPrice');
    if (o.cgst || o.sgst) o.gst = r2(n('cgst') + n('sgst'));
    else if (amt > 0 && n('gstAmt') > 0) o.gst = r2((n('gstAmt') / amt) * 100);
    else if (amt > 0 && n('total') > amt) o.gst = r2(((n('total') - amt) / amt) * 100);
    if (o.gst && !(Number(o.gst) <= 100)) o.gst = '';
  }
  for (const k of DERIVE_ONLY) delete o[k];
  return o;
}
/** Tiles placed already: a column the reader named, or whose heading says what it is; dates by what they hold */
export function autoMap(table) {
  const keys = new Set(TARGETS.map(([k]) => k));
  const map = {};
  table.heads.forEach((h, i) => {
    const field = h.field === 'category' ? 'batch' : h.field;   // the reader calls the Batch column "category"
    const key = keys.has(field) ? field : BY_LABEL.find(([k, test]) => keys.has(k) && test(headKey(h.label)))?.[0];
    if (key && map[key] == null) map[key] = i;
  });
  if (map.exp == null) {
    const taken = new Set(Object.values(map));
    const dated = table.heads.map((_, i) => i).filter((i) => {
      if (taken.has(i)) return false;
      const cells = table.rows.map((r) => String(r[i] || '').trim()).filter(Boolean);
      const months = cells.filter((t) => monthIn(t) && /[/\-.]|[A-Z]{3}/i.test(t) && !/\d{5,}/.test(t));
      return cells.length >= 2 && months.length >= cells.length * 0.6;
    });
    if (dated.length >= 2 && map.mfg == null) { map.mfg = dated[0]; map.exp = dated[1]; } else if (dated.length) map.exp = dated[dated.length - 1];
  }
  return map;
}

/** Pieces in one pack from a bill's pack text: "10's" / "10S" → '10', "1x15" / "1*15" → '15', else '' */
export function packSizeOf(pack) {
  const t = String(pack || '').trim();
  let m = /^\d+\s*[x*×]\s*(\d+)$/i.exec(t);
  if (m) return Number(m[1]) > 0 ? String(Number(m[1])) : '';
  m = /^(\d+)\s*['`’]?\s*s$/i.exec(t);
  return m && Number(m[1]) > 0 ? String(Number(m[1])) : '';
}
