// Pharmacy → Stock In: goods received from a vendor against one of its purchase orders.
// Saving adds each line's Quantity to the item's stock (logged in stock_movements) and makes the line's
// Sel.Amount the item's selling price. An edit applies only the change in quantity.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatStockInNo } from '../../utils/codes.js';
import { selAmount } from '../../../../shared/stockin.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const MAX_LINES = 200;

// Mf.Date / Exp.Date are a month and year ('2030-06'); saved as the 1st (Mf) / last day (Exp) of that month
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const toMonth = (v) => {
  const s = String(v ?? '').trim().slice(0, 7);
  if (!s) return null;
  if (!MONTH.test(s)) throw badRequest('Mf.Date / Exp.Date: choose a month and year', 'VALIDATION');
  return s;
};
const firstDay = (m) => `${m}-01`;
const lastDay = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};
const r2 = (n) => Math.round(n * 100) / 100;

/** The order's lines with what earlier Stock Ins (other than `exceptId`) already received. */
async function orderLines(clinicId, poId, exceptId = 0) {
  return query(
    `SELECT l.id AS po_item_id, l.item_id, l.item_name, l.generic_name, l.manufacturer, l.hsn_code, l.category,
            l.pack, l.mrp, l.rate, l.qty AS ordered,
            COALESCE((SELECT SUM(s.qty) FROM stock_in_items s WHERE s.po_item_id = l.id AND s.stock_in_id <> ?), 0) AS received
       FROM purchase_order_items l WHERE l.po_id = ? AND l.clinic_id = ? ORDER BY l.id`,
    [exceptId, poId, clinicId],
  );
}

/**
 * Checks the Stock In and its lines against the chosen order; lines with no quantity are left out.
 * Exp.Date cannot be a past month and Mf.Date cannot be a future month – except a month kept unchanged when
 * editing (`saved`: po_item_id → { mfg_date, exp_date } as 'YYYY-MM', as saved before).
 */
async function clean(body, clinicId, saved = new Map()) {
  const supplierId = toId(body?.supplier_id, 'vendor');
  const poId = toId(body?.po_id, 'purchase order');
  const [po] = await query('SELECT id, supplier_id FROM purchase_orders WHERE id = ? AND clinic_id = ?', [poId, clinicId]);
  if (!po) throw badRequest('Choose a purchase order', 'VALIDATION');
  if (po.supplier_id !== supplierId) throw badRequest('That purchase order is for another vendor', 'VALIDATION');
  const siDate = body?.si_date || todayISO();
  if (!isISODate(siDate)) throw badRequest('Invalid date', 'VALIDATION');

  const byLine = new Map((await orderLines(clinicId, poId)).map((l) => [l.po_item_id, l]));
  const input = Array.isArray(body?.lines) ? body.lines : [];
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} lines`, 'VALIDATION');
  const lines = [];
  for (const [n, l] of input.entries()) {
    const qty = toAmount(l?.qty, 'quantity');
    if (!qty) continue;
    const po_item = byLine.get(Number(l.po_item_id));
    if (!po_item) throw badRequest(`Line ${n + 1}: not on this purchase order`, 'VALIDATION');
    const name = po_item.item_name;
    const mfg = toMonth(l.mfg_date);
    const exp = toMonth(l.exp_date);
    if (mfg && exp && exp <= mfg) throw badRequest(`${name}: Exp.Date must be after Mf.Date`, 'VALIDATION');
    const before = saved.get(po_item.po_item_id) || {};
    const thisMonth = todayISO().slice(0, 7);
    if (exp && exp < thisMonth && exp !== before.exp_date) throw badRequest(`${name}: Exp.Date cannot be in the past`, 'VALIDATION');
    if (mfg && mfg > thisMonth && mfg !== before.mfg_date) throw badRequest(`${name}: Mf.Date cannot be in the future`, 'VALIDATION');
    const v = {
      rate: Number(po_item.rate), mrp: Number(po_item.mrp),
      sales_percent: toAmount(l.sales_percent, 'Sales %'), disc_percent: toAmount(l.disc_percent, 'Discount %'),
    };
    if (v.sales_percent > 1000) throw badRequest(`${name}: Sales % looks wrong`, 'VALIDATION');
    if (v.disc_percent > 100) throw badRequest(`${name}: Discount % must be 0–100`, 'VALIDATION');
    const sel = selAmount(v);
    if (v.mrp > 0 && sel > v.mrp) throw badRequest(`${name}: Sel.Amount ${sel.toFixed(2)} is more than MRP ${v.mrp.toFixed(2)}`, 'VALIDATION');
    lines.push({
      po_item_id: po_item.po_item_id, item_id: po_item.item_id, item_name: name,
      batch_no: String(l.batch_no ?? '').trim().slice(0, 50) || null, mfg_date: mfg && firstDay(mfg), exp_date: exp && lastDay(exp),
      qty, ...v, sel_amount: sel,
    });
  }
  if (!lines.length) throw badRequest('Enter the quantity received for at least one item', 'VALIDATION');
  return { head: { supplier_id: supplierId, po_id: poId, si_date: siDate }, lines };
}

/**
 * Saves the lines of a Stock In: stock moves by (new − old) quantity per item, never below zero, and
 * each item's selling price becomes its line's Sel.Amount.
 */
async function applyLines(q, clinicId, userId, siId, siNo, supplierId, oldLines, lines) {
  const change = new Map();
  for (const l of oldLines) change.set(l.item_id, (change.get(l.item_id) || 0) - Number(l.qty));
  for (const l of lines) change.set(l.item_id, (change.get(l.item_id) || 0) + l.qty);
  const isEdit = oldLines.length > 0;
  for (const [itemId, diff] of change) {
    if (!r2(diff)) continue;
    const [item] = await q('SELECT name, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
    const balance = r2(Number(item.stock_qty) + diff);
    if (balance < 0) throw badRequest(`${item.name}: stock would go below zero (now ${item.stock_qty})`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, itemId]);
    await insertRow(q, 'stock_movements', {
      clinic_id: clinicId, item_id: itemId, qty_change: r2(diff), balance_after: balance,
      reason: isEdit ? 'adjustment' : 'purchase', ref_type: 'stock_in', ref_id: siId, supplier_id: supplierId,
      note: isEdit ? `Stock In ${siNo} changed` : `Stock In ${siNo}`, created_by: userId,
    });
  }
  for (const l of lines) await q('UPDATE items SET price = ?, updated_at = NOW() WHERE id = ?', [l.sel_amount, l.item_id]);
  await q('DELETE FROM stock_in_items WHERE stock_in_id = ? AND clinic_id = ?', [siId, clinicId]);
  for (const l of lines) await insertRow(q, 'stock_in_items', { clinic_id: clinicId, stock_in_id: siId, ...l });
}

async function loadStockIn(clinicId, id) {
  const [si] = await query(
    `SELECT si.*, s.name AS supplier_name, p.po_no FROM stock_ins si
       JOIN suppliers s ON s.id = si.supplier_id JOIN purchase_orders p ON p.id = si.po_id
      WHERE si.id = ? AND si.clinic_id = ?`, [id, clinicId],
  );
  if (!si) throw notFound('Stock In');
  si.lines = await query('SELECT * FROM stock_in_items WHERE stock_in_id = ? ORDER BY id', [id]);
  return si;
}

// GET /api/stock-in?q=&page= – newest first
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['si.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.supplier_id) {                      // Return: one vendor's Stock Ins
    where.push('si.supplier_id = ?');
    params.push(toId(req.query.supplier_id, 'vendor'));
  }
  if (req.query.q) {
    where.push('(si.si_no LIKE ? OR p.po_no LIKE ? OR s.name LIKE ?)');
    params.push(like(req.query.q), like(req.query.q), like(req.query.q));
  }
  const w = where.join(' AND ');
  const from = 'FROM stock_ins si JOIN suppliers s ON s.id = si.supplier_id JOIN purchase_orders p ON p.id = si.po_id';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} WHERE ${w}`, params);
  const rows = await query(
    `SELECT si.id, si.si_no, si.si_date, s.name AS supplier_name, p.po_no,
            (SELECT COUNT(*) FROM stock_in_items i WHERE i.stock_in_id = si.id) AS item_count,
            (SELECT SUM(i.qty) FROM stock_in_items i WHERE i.stock_in_id = si.id) AS total_qty
       ${from} WHERE ${w} ORDER BY si.si_date DESC, si.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

// GET /api/stock-in/lines?q=&group=item|date&page= – Stock In → List: one row per item and batch received, with
//   Buy Amount = Qty × Cur.Rate; Sale Amount = Qty × (Cur.Rate + Sales %); Discount Amount = Discount % of
//   the Sale Amount; Net Sale Amount = Qty × Sel.Amount – and the same four summed over every matching row.
//   group=item (Item wise): sorted by item, then batch; group=date (Date wise): newest Stock In date first.
//   `groups` has the totals of each item / date on the page, counted over every matching row.
router.get('/lines', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 200 });
  const byDate = req.query.group === 'date';
  const groupCol = byDate ? 'si.si_date' : 'l.item_name';
  const where = ['si.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(l.item_name LIKE ? OR l.batch_no LIKE ? OR si.si_no LIKE ? OR s.name LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const from = `FROM stock_in_items l JOIN stock_ins si ON si.id = l.stock_in_id JOIN suppliers s ON s.id = si.supplier_id
     CROSS APPLY (SELECT ROUND(l.qty * l.rate, 2) AS buy_amount,
                         ROUND(l.qty * l.rate * (1 + l.sales_percent / 100), 2) AS sale_amount,
                         ROUND(l.qty * l.sel_amount, 2) AS net_amount) a`;
  const [sum] = await query(
    `SELECT COUNT(*) AS total, SUM(l.qty) AS qty, SUM(a.buy_amount) AS buy_amount, SUM(a.sale_amount) AS sale_amount,
            SUM(a.net_amount) AS net_amount ${from} WHERE ${w}`, params,
  );
  const rows = await query(
    `SELECT l.id, l.stock_in_id, si.si_no, si.si_date, s.name AS supplier_name, l.item_name, l.batch_no, l.exp_date,
            l.qty, l.rate, l.sales_percent, l.disc_percent, l.sel_amount,
            a.buy_amount, a.sale_amount, a.net_amount, a.sale_amount - a.net_amount AS disc_amount
       ${from} WHERE ${w}
      ORDER BY ${byDate ? 'si.si_date DESC, si.si_no DESC, l.item_name, l.batch_no' : 'l.item_name, l.batch_no, si.si_date DESC, l.id DESC'} ${pageSql}`,
    [...params, offset, limit],
  );
  const n = (v) => Number(v || 0);
  // group totals (over every matching row, also those on other pages) for the items / dates on this page
  const keys = [...new Set(rows.map((r) => (byDate ? r.si_date : r.item_name)))];
  const groups = keys.length ? await query(
    `SELECT ${groupCol} AS group_key, COUNT(*) AS batches, COUNT(DISTINCT si.id) AS entries, SUM(l.qty) AS qty,
            SUM(a.buy_amount) AS buy_amount, SUM(a.sale_amount) AS sale_amount, SUM(a.net_amount) AS net_amount
       ${from} WHERE ${w} AND ${groupCol} IN (${keys.map(() => '?').join(', ')}) GROUP BY ${groupCol}`,
    [...params, ...keys],
  ) : [];
  for (const g of groups) g.disc_amount = Math.round((n(g.sale_amount) - n(g.net_amount)) * 100) / 100;
  res.json({
    rows, groups, total: sum.total, page, limit,
    totals: {
      qty: n(sum.qty), buy_amount: n(sum.buy_amount), sale_amount: n(sum.sale_amount), net_amount: n(sum.net_amount),
      disc_amount: Math.round((n(sum.sale_amount) - n(sum.net_amount)) * 100) / 100,
    },
  });
});

// GET /api/stock-in/order/:poId?except= – the order's lines to receive (ordered, already received)
router.get('/order/:poId', async (req, res) => {
  const poId = toId(req.params.poId);
  const [po] = await query('SELECT id FROM purchase_orders WHERE id = ? AND clinic_id = ?', [poId, req.clinicId]);
  if (!po) throw notFound('Purchase order');
  const except = req.query.except ? toId(req.query.except) : 0;
  res.json({ rows: await orderLines(req.clinicId, poId, except) });
});

router.get('/:id', async (req, res) => {
  res.json(await loadStockIn(req.clinicId, toId(req.params.id)));
});

// POST /api/stock-in { supplier_id, po_id, si_date, lines: [{ po_item_id, batch_no, mfg_date, exp_date, qty, sales_percent, disc_percent }] }
router.post('/', async (req, res) => {
  const { head, lines } = await clean(req.body, req.clinicId);
  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const siNo = formatStockInNo(clinic.code, await nextSequence(q, req.clinicId, 'stockin'));
    const siId = await insertRow(q, 'stock_ins', { ...head, si_no: siNo, clinic_id: req.clinicId, created_by: req.user.id });
    await applyLines(q, req.clinicId, req.user.id, siId, siNo, head.supplier_id, [], lines);
    return siId;
  });
  res.status(201).json(await loadStockIn(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);   // month as saved
  const savedDates = new Map((await query('SELECT po_item_id, mfg_date, exp_date FROM stock_in_items WHERE stock_in_id = ? AND clinic_id = ?', [id, req.clinicId]))
    .map((l) => [l.po_item_id, { mfg_date: iso(l.mfg_date), exp_date: iso(l.exp_date) }]));
  const { head, lines } = await clean(req.body, req.clinicId, savedDates);
  await tx(async (q) => {
    const [si] = await q('SELECT si_no FROM stock_ins WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!si) throw notFound('Stock In');
    // once goods from it are returned to the vendor (Return), its lines are fixed
    const [returned] = await q('SELECT TOP 1 return_no FROM purchase_returns WHERE stock_in_id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (returned) throw badRequest(`Return ${returned.return_no} is already made from this Stock In – it can no longer be changed`, 'VALIDATION');
    const [sold] = await q(
      'SELECT TOP 1 s.sale_no FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN stock_in_items l ON l.id = i.stock_in_item_id WHERE l.stock_in_id = ?', [id],
    );
    if (sold) throw badRequest(`Sale ${sold.sale_no} is already made from this Stock In's batches – it can no longer be changed`, 'VALIDATION');
    const old = await q('SELECT item_id, qty FROM stock_in_items WHERE stock_in_id = ?', [id]);
    await q('UPDATE stock_ins SET supplier_id = ?, po_id = ?, si_date = ?, updated_at = NOW() WHERE id = ?',
      [head.supplier_id, head.po_id, head.si_date, id]);
    await applyLines(q, req.clinicId, req.user.id, id, si.si_no, head.supplier_id, old, lines);
  });
  res.json(await loadStockIn(req.clinicId, id));
});

export default router;
