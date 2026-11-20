// Pharmacy → Stock In → Three in One (IPS): Item, Purchase / Order and Stock In from one supplier bill.
// Save All checks every row the same way the three screens do, then in ONE transaction:
//   1. adds the rows' new items to the Item list (an item with the same Name and Type / Unit is used as it is),
//   2. saves the Purchase / Order (Rate = P.Rate less Disc %, GST split into CGST / SGST – shared/purchase.js),
//   3. saves the Stock In for all of it (Batch, Mf / Exp month, R.Order + R.Free, S.Disc %), which adds the stock
//      and sets each item's selling price (stockins.applyLines).
// If anything is wrong nothing is saved. A Draft keeps the whole screen (any state) and never touches items,
// orders, stock or prices; Save All deletes the draft it came from.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, forbidden, notFound, toAmount, toId } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatItemCode, formatPurchaseNo, formatStockInNo } from '../../utils/codes.js';
import { lockStock } from '../../utils/stock.js';
import { calcLine, roundOffOf, splitGst } from '../../../../shared/purchase.js';
import { selAmount } from '../../../../shared/stockin.js';
import { userCan } from '../../../../shared/permissions.js';
import { applyLines } from './stockins.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const MAX_LINES = 200;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const text = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const firstDay = (m) => `${m}-01`;
const lastDay = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Checks the bill and every row; returns the cleaned rows (with the matched item, if any). */
async function clean(body, clinicId) {
  const supplierId = toId(body?.supplier_id, 'vendor');
  const [vendor] = await query('SELECT id, name FROM suppliers WHERE id = ? AND clinic_id = ?', [supplierId, clinicId]);
  if (!vendor) throw badRequest('Choose a vendor', 'VALIDATION');
  const date = body?.date || todayISO();
  if (!isISODate(date)) throw badRequest('Invalid date', 'VALIDATION');
  if (date > todayISO()) throw badRequest('Date cannot be in the future', 'VALIDATION');
  const billNo = String(body?.bill_no ?? '').trim().toUpperCase();
  if (!billNo) throw badRequest('Enter the Bill No of the supplier bill', 'VALIDATION');
  if (billNo.length > 50) throw badRequest('Bill No: at most 50 characters', 'VALIDATION');
  const [dup] = await query('SELECT TOP 1 si_no FROM stock_ins WHERE clinic_id = ? AND supplier_id = ? AND bill_no = ?', [clinicId, supplierId, billNo]);
  if (dup) throw badRequest(`Bill ${billNo} of ${vendor.name} is already in as ${dup.si_no}`, 'VALIDATION');

  const input = (Array.isArray(body?.rows) ? body.rows : []).filter((r) => String(r?.name ?? '').trim() || r?.item_id);
  if (!input.length) throw badRequest('Add at least one item', 'VALIDATION');
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} items per bill`, 'VALIDATION');
  const thisMonth = todayISO().slice(0, 7);
  const rows = [];
  for (const [n, r] of input.entries()) {
    const at = `Row ${n + 1}`;
    let item = null;
    if (r.item_id) {
      [item] = await query('SELECT id, name, unit FROM items WHERE id = ? AND clinic_id = ?', [toId(r.item_id, 'item'), clinicId]);
      if (!item) throw badRequest(`${at}: item not found`, 'VALIDATION');
    }
    const name = item?.name || text(r.name, 200);
    if (!name) throw badRequest(`${at}: enter the Item Name`, 'VALIDATION');
    const unit = item?.unit || text(r.unit, 30) || 'nos';
    if (!item) {
      [item] = await query('SELECT TOP 1 id, name, unit FROM items WHERE clinic_id = ? AND LOWER(name) = LOWER(?) AND LOWER(unit) = LOWER(?)', [clinicId, name, unit]);
    }
    const gst = r.cgst_percent !== undefined || r.sgst_percent !== undefined
      ? { cgst_percent: toAmount(r.cgst_percent, 'CGST %'), sgst_percent: toAmount(r.sgst_percent, 'SGST %') }
      : splitGst(toAmount(r.gst, 'GST %'));
    const v = {
      mrp: toAmount(r.mrp, 'MRP'), p_rate: toAmount(r.p_rate, 'P.Rate'), disc_percent: toAmount(r.disc_percent, 'Disc %'),
      qty: toAmount(r.qty, 'Qty'), free_qty: toAmount(r.free_qty, 'Free'), ...gst,
    };
    if (!(v.mrp > 0)) throw badRequest(`${name}: enter the MRP`, 'VALIDATION');
    if (!(v.p_rate > 0)) throw badRequest(`${name}: enter the P.Rate`, 'VALIDATION');
    if (v.p_rate > v.mrp) throw badRequest(`${name}: P.Rate ${v.p_rate.toFixed(2)} is more than MRP ${v.mrp.toFixed(2)}`, 'VALIDATION');
    if (v.disc_percent > 100) throw badRequest(`${name}: Disc % must be 0–100`, 'VALIDATION');
    if (v.cgst_percent + v.sgst_percent > 28) throw badRequest(`${name}: GST % looks wrong`, 'VALIDATION');
    if (!(v.qty > 0) && !(v.free_qty > 0)) throw badRequest(`${name}: enter the quantity`, 'VALIDATION');
    const mfg = text(r.mfg, 7);
    const exp = text(r.exp, 7);
    if (mfg && !MONTH.test(mfg)) throw badRequest(`${name}: Mf.Date – enter the month as MM/YY`, 'VALIDATION');
    if (exp && !MONTH.test(exp)) throw badRequest(`${name}: Exp.Date – enter the month as MM/YY`, 'VALIDATION');
    if (exp && exp < thisMonth) throw badRequest(`${name}: Exp.Date cannot be in the past`, 'VALIDATION');
    if (mfg && mfg > thisMonth) throw badRequest(`${name}: Mf.Date cannot be in the future`, 'VALIDATION');
    if (mfg && exp && exp <= mfg) throw badRequest(`${name}: Exp.Date must be after Mf.Date`, 'VALIDATION');
    const sDisc = toAmount(r.s_disc, 'S.Disc %');
    if (sDisc > 100) throw badRequest(`${name}: S.Disc % must be 0–100`, 'VALIDATION');
    rows.push({
      item_id: item?.id || null, name, unit,
      details: {
        generic_name: text(r.generic_name, 150), manufacturer: text(r.manufacturer, 150), hsn_code: text(r.hsn_code, 20),
        category: text(r.category, 100), pack: text(r.pack, 50),
      },
      ...v, ...calcLine(v),
      batch_no: text(r.batch_no, 50), mfg_date: mfg && firstDay(mfg), exp_date: exp && lastDay(exp), s_disc: sDisc,
    });
  }
  for (const r of rows) {
    if (r.details.hsn_code && !/^[0-9A-Za-z]{2,20}$/.test(r.details.hsn_code)) throw badRequest(`${r.name}: HSN code – letters and digits only`, 'VALIDATION');
  }
  const sum = r2(rows.reduce((s, r) => s + r.total, 0));
  const roundOff = body?.round_off ? roundOffOf(sum) : 0;
  return { supplierId, vendor, date, billNo, rows, sum, roundOff };
}

// POST /api/ips/save { supplier_id, date, bill_no, details, round_off, draft_id?, rows: [{ item_id?, name, unit, generic_name,
//   manufacturer, hsn_code, category, pack, mrp, p_rate, disc_percent, qty, free_qty, gst | cgst_percent + sgst_percent,
//   batch_no, mfg: 'YYYY-MM', exp: 'YYYY-MM', s_disc }] }
router.post('/save', async (req, res) => {
  const c = await clean(req.body, req.clinicId);
  const newCount = c.rows.filter((r) => !r.item_id).length;
  if (newCount && !userCan(req.user, 'item.manage')) throw forbidden('Adding new items needs the Item (add / edit) permission');
  const draftId = req.body?.draft_id ? toId(req.body.draft_id, 'draft') : null;
  const details = text(req.body?.details, 1000);

  const result = await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    // 1. new items (a second row with the same new item uses the one just added)
    const added = new Map();
    for (const r of c.rows) {
      if (r.item_id) continue;
      const key = `${r.name.toLowerCase()}|${r.unit.toLowerCase()}`;
      if (!added.has(key)) {
        const n = await nextSequence(q, req.clinicId, 'item');
        added.set(key, await insertRow(q, 'items', {
          clinic_id: req.clinicId, item_code: formatItemCode(clinic.code, n), name: r.name, unit: r.unit, ...r.details,
          mrp: r.mrp, purchase_rate: r.rate, price: selAmount({ mrp: r.mrp, disc_percent: r.s_disc }),
          cgst_percent: r.cgst_percent, sgst_percent: r.sgst_percent, gst_percent: r.gst_percent, stock_qty: 0, created_by: req.user.id,
        }));
      }
      r.item_id = added.get(key);
    }
    // 2. the order
    const poNo = formatPurchaseNo(clinic.code, await nextSequence(q, req.clinicId, 'purchase'));
    const poId = await insertRow(q, 'purchase_orders', {
      clinic_id: req.clinicId, po_no: poNo, supplier_id: c.supplierId, po_date: c.date, details: details || `Bill ${c.billNo}`,
      round_off: c.roundOff, total_amount: r2(c.sum + c.roundOff), created_by: req.user.id,
    });
    const siLines = [];
    for (const r of c.rows) {
      const poItemId = await insertRow(q, 'purchase_order_items', {
        clinic_id: req.clinicId, po_id: poId, item_id: r.item_id, item_name: r.name, unit: r.unit, ...r.details,
        mrp: r.mrp, p_rate: r.p_rate, disc_percent: r.disc_percent, rate: r.rate, qty: r.qty, free_qty: r.free_qty,
        amount: r.amount, cgst_percent: r.cgst_percent, sgst_percent: r.sgst_percent, gst_percent: r.gst_percent,
        gst_amount: r.gst_amount, total: r.total,
      });
      siLines.push({
        po_item_id: poItemId, item_id: r.item_id, item_name: r.name, batch_no: r.batch_no, mfg_date: r.mfg_date, exp_date: r.exp_date,
        qty: r.qty, free_qty: r.free_qty, rate: r.rate, mrp: r.mrp, sales_percent: 0, disc_percent: r.s_disc,
        sel_amount: selAmount({ mrp: r.mrp, disc_percent: r.s_disc }),
      });
    }
    // 3. the Stock In (stock + selling prices)
    const siNo = formatStockInNo(clinic.code, await nextSequence(q, req.clinicId, 'stockin'));
    const siId = await insertRow(q, 'stock_ins', {
      clinic_id: req.clinicId, si_no: siNo, supplier_id: c.supplierId, po_id: poId, si_date: c.date, bill_no: c.billNo, created_by: req.user.id,
    });
    await applyLines(q, req.clinicId, req.user.id, siId, c.supplierId, [], siLines, `Stock In ${siNo} (Three in One)`);
    if (draftId) await q('DELETE FROM ips_drafts WHERE id = ? AND clinic_id = ?', [draftId, req.clinicId]);
    return { po_id: poId, po_no: poNo, stock_in_id: siId, si_no: siNo, new_items: added.size, total: r2(c.sum + c.roundOff) };
  });
  res.status(201).json(result);
});

/* ---------- Drafts ---------- */

// GET /api/ips/drafts – newest first
router.get('/drafts', async (req, res) => {
  const rows = await query(
    `SELECT d.id, d.bill_no, d.draft_date, d.line_count, d.total, d.updated_at, d.supplier_id, s.name AS supplier_name
       FROM ips_drafts d LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.clinic_id = ? ORDER BY d.updated_at DESC, d.id DESC`, [req.clinicId],
  );
  res.json({ rows });
});

router.get('/drafts/:id', async (req, res) => {
  const [d] = await query('SELECT * FROM ips_drafts WHERE id = ? AND clinic_id = ?', [toId(req.params.id), req.clinicId]);
  if (!d) throw notFound('Draft');
  let data = {};
  try { data = JSON.parse(d.data); } catch { /* keep {} */ }
  res.json({ ...d, data });
});

// POST /api/ips/drafts { id?, supplier_id?, bill_no?, date?, total, data: { …the whole screen… } } – needs a vendor or a Bill No
router.post('/drafts', async (req, res) => {
  const b = req.body || {};
  const supplierId = b.supplier_id ? toId(b.supplier_id, 'vendor') : null;
  if (supplierId) {
    const [s] = await query('SELECT id FROM suppliers WHERE id = ? AND clinic_id = ?', [supplierId, req.clinicId]);
    if (!s) throw badRequest('Choose a vendor', 'VALIDATION');
  }
  const billNo = String(b.bill_no ?? '').trim().toUpperCase().slice(0, 50) || null;
  if (!supplierId && !billNo) throw badRequest('A draft needs a vendor or a Bill No', 'VALIDATION');
  const data = JSON.stringify(b.data ?? {});
  if (data.length > 1_000_000) throw badRequest('The draft is too large', 'VALIDATION');
  const row = {
    supplier_id: supplierId, bill_no: billNo, draft_date: isISODate(b.date) ? b.date : null,
    line_count: Math.max(0, Math.min(MAX_LINES, Number(b.line_count) || 0)), total: toAmount(b.total, 'total'), data,
  };
  let id = b.id ? toId(b.id, 'draft') : null;
  if (id) {
    const r = await query(
      'UPDATE ips_drafts SET supplier_id = ?, bill_no = ?, draft_date = ?, line_count = ?, total = ?, data = ?, updated_at = NOW() WHERE id = ? AND clinic_id = ?',
      [row.supplier_id, row.bill_no, row.draft_date, row.line_count, row.total, row.data, id, req.clinicId],
    );
    if (!r.affectedRows) throw notFound('Draft');
  } else {
    id = await insertRow(query, 'ips_drafts', { clinic_id: req.clinicId, ...row, created_by: req.user.id });
  }
  // a warning (still saved) when the same vendor's Bill No is already in a Stock In or another draft
  let warning = null;
  if (supplierId && billNo) {
    const [si] = await query('SELECT TOP 1 si_no FROM stock_ins WHERE clinic_id = ? AND supplier_id = ? AND bill_no = ?', [req.clinicId, supplierId, billNo]);
    const [other] = await query('SELECT TOP 1 id FROM ips_drafts WHERE clinic_id = ? AND supplier_id = ? AND bill_no = ? AND id <> ?', [req.clinicId, supplierId, billNo, id]);
    if (si) warning = `This bill is already in as ${si.si_no}`;
    else if (other) warning = 'Another draft has the same vendor and Bill No';
  }
  res.json({ id, warning });
});

router.delete('/drafts/:id', async (req, res) => {
  const r = await query('DELETE FROM ips_drafts WHERE id = ? AND clinic_id = ?', [toId(req.params.id), req.clinicId]);
  if (!r.affectedRows) throw notFound('Draft');
  res.json({ ok: true });
});

export default router;
