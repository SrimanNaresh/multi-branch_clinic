// Pharmacy → Sales: counter sale to a customer (Date, Customer Name, Mobile No and the items sold).
// Each line may be sold from a batch (a Stock In line): its stock there is received − returned − sold.
// Saving takes each line's quantity out of the item's stock (stock_movements, reason 'issue', ref_type 'sale');
// an edit applies only the change in quantity.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatSaleNo } from '../../utils/codes.js';

const router = Router();
router.use(clinicScope(), requirePermission('dispense'));

const MAX_LINES = 200;
const r2 = (n) => Math.round(n * 100) / 100;

/** The item's batches with stock left (earliest expiry first); `exceptSale`'s own lines count as not sold. */
async function batchesOf(clinicId, itemId, exceptSale = 0) {
  return query(
    `SELECT l.id AS stock_in_item_id, l.batch_no, l.mfg_date, l.exp_date, l.sel_amount, l.mrp, si.si_no,
            l.qty - COALESCE((SELECT SUM(r.qty) FROM purchase_return_items r WHERE r.stock_in_item_id = l.id), 0)
                  - COALESCE((SELECT SUM(s.qty) FROM sale_items s WHERE s.stock_in_item_id = l.id AND s.sale_id <> ?), 0) AS available
       FROM stock_in_items l JOIN stock_ins si ON si.id = l.stock_in_id
      WHERE l.item_id = ? AND l.clinic_id = ?
      ORDER BY CASE WHEN l.exp_date IS NULL THEN 1 ELSE 0 END, l.exp_date, l.id`,
    [exceptSale, itemId, clinicId],
  );
}

/** Checks the sale and its lines (batch stock, price not above MRP); lines with no item or quantity are left out. */
async function clean(body, clinicId, exceptSale = 0) {
  const date = body?.sale_date || todayISO();
  if (!isISODate(date)) throw badRequest('Invalid date', 'VALIDATION');
  const customer = String(body?.customer_name ?? '').trim().slice(0, 150);
  if (!customer) throw badRequest('Enter the customer name', 'VALIDATION');
  const mobile = String(body?.mobile ?? '').trim().slice(0, 20) || null;
  if (mobile && !/^[0-9+\- ]{6,20}$/.test(mobile)) throw badRequest('Mobile No: digits only', 'VALIDATION');

  const input = Array.isArray(body?.lines) ? body.lines.filter((l) => l?.item_id && Number(l.qty) > 0) : [];
  if (!input.length) throw badRequest('Add at least one item with a quantity', 'VALIDATION');
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} items per sale`, 'VALIDATION');

  const batchCache = new Map();
  const usedFromBatch = new Map();   // the same batch on two lines counts once against its stock
  const lines = [];
  for (const l of input) {
    const itemId = toId(l.item_id, 'item');
    const [item] = await query('SELECT id, name, mrp FROM items WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
    if (!item) throw badRequest('Item not found', 'VALIDATION');
    const qty = toAmount(l.qty, 'quantity');
    const price = toAmount(l.price, 'sale price');
    let batch = null;
    if (l.stock_in_item_id) {
      if (!batchCache.has(itemId)) batchCache.set(itemId, await batchesOf(clinicId, itemId, exceptSale));
      batch = batchCache.get(itemId).find((b) => b.stock_in_item_id === Number(l.stock_in_item_id));
      if (!batch) throw badRequest(`${item.name}: that batch is not in stock`, 'VALIDATION');
      const used = r2((usedFromBatch.get(batch.stock_in_item_id) || 0) + qty);
      if (used > Number(batch.available)) throw badRequest(`${item.name} (batch ${batch.batch_no || '—'}): only ${Number(batch.available)} in stock`, 'VALIDATION');
      usedFromBatch.set(batch.stock_in_item_id, used);
    }
    const mrp = Number(batch?.mrp || item.mrp || 0);
    if (mrp > 0 && price > mrp) throw badRequest(`${item.name}: sale price is more than MRP ${mrp.toFixed(2)}`, 'VALIDATION');
    lines.push({
      item_id: item.id, item_name: item.name, stock_in_item_id: batch?.stock_in_item_id || null,
      batch_no: batch?.batch_no || null, exp_date: batch?.exp_date || null, qty, price, amount: r2(qty * price),
    });
  }
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { head: { sale_date: date, customer_name: customer, mobile, total_amount: total }, lines };
}

/** Saves the lines of a sale: stock goes down by (new − old) quantity per item, never below zero. */
async function applyLines(q, clinicId, userId, saleId, saleNo, oldLines, lines) {
  const change = new Map();
  for (const l of oldLines) change.set(l.item_id, (change.get(l.item_id) || 0) + Number(l.qty));
  for (const l of lines) change.set(l.item_id, (change.get(l.item_id) || 0) - l.qty);
  const isEdit = oldLines.length > 0;
  for (const [itemId, diff] of change) {
    if (!r2(diff)) continue;
    const [item] = await q('SELECT name, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
    const balance = r2(Number(item.stock_qty) + diff);
    if (balance < 0) throw badRequest(`${item.name}: only ${item.stock_qty} in stock`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, itemId]);
    await insertRow(q, 'stock_movements', {
      clinic_id: clinicId, item_id: itemId, qty_change: r2(diff), balance_after: balance,
      reason: 'issue', ref_type: 'sale', ref_id: saleId,
      note: isEdit ? `Sale ${saleNo} changed` : `Sale ${saleNo}`, created_by: userId,
    });
  }
  await q('DELETE FROM sale_items WHERE sale_id = ? AND clinic_id = ?', [saleId, clinicId]);
  for (const l of lines) await insertRow(q, 'sale_items', { clinic_id: clinicId, sale_id: saleId, ...l });
}

async function loadSale(clinicId, id) {
  const [sale] = await query('SELECT * FROM sales WHERE id = ? AND clinic_id = ?', [id, clinicId]);
  if (!sale) throw notFound('Sale');
  sale.lines = await query('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [id]);
  return sale;
}

// GET /api/sales?q=&page= – newest first, with the item names on each sale
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['s.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push(`(s.sale_no LIKE ? OR s.customer_name LIKE ? OR s.mobile LIKE ?
                 OR EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.item_name LIKE ?))`);
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const [{ total, amount }] = await query(`SELECT COUNT(*) AS total, SUM(s.total_amount) AS amount FROM sales s WHERE ${w}`, params);
  const rows = await query(
    `SELECT s.id, s.sale_no, s.sale_date, s.customer_name, s.mobile, s.total_amount,
            (SELECT STRING_AGG(i.item_name, ', ') WITHIN GROUP (ORDER BY i.id) FROM sale_items i WHERE i.sale_id = s.id) AS item_names,
            (SELECT SUM(i.qty) FROM sale_items i WHERE i.sale_id = s.id) AS total_qty
       FROM sales s WHERE ${w} ORDER BY s.sale_date DESC, s.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit, amount: Number(amount || 0) });
});

// GET /api/sales/batches/:itemId?except= – the item's batches with stock left, its total stock and where it is kept
router.get('/batches/:itemId', async (req, res) => {
  const itemId = toId(req.params.itemId);
  const [item] = await query('SELECT id, stock_qty, price, mrp, rack, box FROM items WHERE id = ? AND clinic_id = ?', [itemId, req.clinicId]);
  if (!item) throw notFound('Item');
  const except = req.query.except ? toId(req.query.except) : 0;
  const rows = (await batchesOf(req.clinicId, itemId, except)).filter((b) => Number(b.available) > 0);
  res.json({ rows, stock_qty: Number(item.stock_qty), price: Number(item.price), mrp: Number(item.mrp), rack: item.rack, box: item.box });
});

router.get('/:id', async (req, res) => {
  res.json(await loadSale(req.clinicId, toId(req.params.id)));
});

// POST /api/sales { sale_date, customer_name, mobile, lines: [{ item_id, stock_in_item_id?, qty, price }] }
router.post('/', async (req, res) => {
  const { head, lines } = await clean(req.body, req.clinicId);
  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const saleNo = formatSaleNo(clinic.code, await nextSequence(q, req.clinicId, 'sale'));
    const saleId = await insertRow(q, 'sales', { ...head, sale_no: saleNo, clinic_id: req.clinicId, created_by: req.user.id });
    await applyLines(q, req.clinicId, req.user.id, saleId, saleNo, [], lines);
    return saleId;
  });
  res.status(201).json(await loadSale(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { head, lines } = await clean(req.body, req.clinicId, id);
  await tx(async (q) => {
    const [sale] = await q('SELECT sale_no FROM sales WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!sale) throw notFound('Sale');
    const old = await q('SELECT item_id, qty FROM sale_items WHERE sale_id = ?', [id]);
    await q('UPDATE sales SET sale_date = ?, customer_name = ?, mobile = ?, total_amount = ?, updated_at = NOW() WHERE id = ?',
      [head.sale_date, head.customer_name, head.mobile, head.total_amount, id]);
    await applyLines(q, req.clinicId, req.user.id, id, sale.sale_no, old, lines);
  });
  res.json(await loadSale(req.clinicId, id));
});

export default router;
