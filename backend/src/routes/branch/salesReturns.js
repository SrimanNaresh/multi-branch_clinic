// Pharmacy → Return → Sales Return: goods a customer brings back from one of their sales.
// Each line comes from a sale line and keeps its batch, Sell by (pack / unit), Sale Price and Disc %; the sale's
// Bill Discount % applies to the return too (shared/sale.js). A line cannot return more than was sold, less what
// earlier returns took back. Saving puts the packs back into stock and into the batch they were sold from
// (stock_movements, reason 'return', ref_type 'sales_return'). A sale with a return can no longer be edited.
// Only an Admin may delete a Sales Return.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, forbidden, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatSalesReturnNo } from '../../utils/codes.js';
import { assertBatchesNotNegative, isAdmin, lockStock, moveItemStock } from '../../utils/stock.js';
import { lineAmount, packsOf, saleTotals } from '../../../../shared/sale.js';

const router = Router();
router.use(clinicScope(), requirePermission('sales.return'));

const MAX_LINES = 200;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** The sale's lines with what earlier returns (other than `exceptId`) already took back, in sale units. */
async function saleLines(q, clinicId, saleId, exceptId = 0) {
  return q(
    `SELECT i.id AS sale_item_id, i.item_id, i.item_name, i.stock_in_item_id, i.batch_no, i.exp_date, i.sale_unit,
            COALESCE(i.unit_qty, i.qty) AS sold, i.pack_size, i.price, i.disc_percent,
            COALESCE((SELECT SUM(x.unit_qty) FROM sales_return_items x WHERE x.sale_item_id = i.id AND x.sales_return_id <> ?), 0) AS returned
       FROM sale_items i WHERE i.sale_id = ? AND i.clinic_id = ? ORDER BY i.id`,
    [exceptId, saleId, clinicId],
  );
}

/** Checks the return against its sale; lines with no quantity are left out. Runs inside the save's stock lock. */
async function clean(q, body, clinicId, exceptId = 0) {
  const saleId = toId(body?.sale_id, 'sale');
  const [sale] = await q('SELECT id, sale_date, customer_name, mobile, disc_percent FROM sales WHERE id = ? AND clinic_id = ?', [saleId, clinicId]);
  if (!sale) throw badRequest('Choose the sale', 'VALIDATION');
  const date = body?.return_date || todayISO();
  if (!isISODate(date)) throw badRequest('Invalid date', 'VALIDATION');
  if (date < String(sale.sale_date).slice(0, 10)) throw badRequest('Return date cannot be before the sale date', 'VALIDATION');
  if (date > todayISO()) throw badRequest('Return date cannot be in the future', 'VALIDATION');

  const byLine = new Map((await saleLines(q, clinicId, saleId, exceptId)).map((l) => [l.sale_item_id, l]));
  const input = Array.isArray(body?.lines) ? body.lines : [];
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} lines`, 'VALIDATION');
  const lines = [];
  for (const [n, l] of input.entries()) {
    const qty = toAmount(l?.qty, 'quantity');
    if (!qty) continue;
    const src = byLine.get(Number(l.sale_item_id));
    if (!src) throw badRequest(`Line ${n + 1}: not on this sale`, 'VALIDATION');
    const left = r2(Number(src.sold) - Number(src.returned));
    if (qty > left) throw badRequest(`${src.item_name}: only ${left} can be returned`, 'VALIDATION');
    const line = {
      qty, price: Number(src.price), disc_percent: Number(src.disc_percent), sale_unit: src.sale_unit || 'pack', pack_size: Number(src.pack_size) || 1,
    };
    lines.push({
      sale_item_id: src.sale_item_id, item_id: src.item_id, item_name: src.item_name, stock_in_item_id: src.stock_in_item_id,
      batch_no: src.batch_no, exp_date: src.exp_date, sale_unit: line.sale_unit, unit_qty: qty, pack_size: line.pack_size,
      qty: packsOf(line), price: line.price, disc_percent: line.disc_percent, amount: lineAmount(line),
    });
  }
  if (!lines.length) throw badRequest('Enter the quantity returned for at least one item', 'VALIDATION');
  const sums = saleTotals(lines.map((l) => ({ ...l, qty: l.unit_qty })), sale.disc_percent);
  return {
    head: {
      sale_id: saleId, return_date: date, customer_name: sale.customer_name, mobile: sale.mobile,
      disc_percent: Number(sale.disc_percent), sub_total: sums.sub_total, discount_amount: sums.discount_amount, total_amount: sums.total_amount,
    },
    lines,
  };
}

/** Saves the lines: stock goes up by (new − old) packs per item; batches never go below zero. */
async function applyLines(q, clinicId, userId, id, no, oldLines, lines) {
  const change = new Map();
  for (const l of oldLines) change.set(l.item_id, (change.get(l.item_id) || 0) - Number(l.qty));
  for (const l of lines) change.set(l.item_id, (change.get(l.item_id) || 0) + l.qty);
  const isEdit = oldLines.length > 0;
  await moveItemStock(q, clinicId, userId, change, {
    reason: isEdit ? 'adjustment' : 'return', ref_type: 'sales_return', ref_id: id,
    note: !isEdit ? `Sales Return ${no}` : lines.length ? `Sales Return ${no} changed` : `Sales Return ${no} deleted`,
  });
  await q('DELETE FROM sales_return_items WHERE sales_return_id = ? AND clinic_id = ?', [id, clinicId]);
  for (const l of lines) await insertRow(q, 'sales_return_items', { clinic_id: clinicId, sales_return_id: id, ...l });
  await assertBatchesNotNegative(q, clinicId, oldLines.map((l) => l.stock_in_item_id));
}

async function loadReturn(clinicId, id) {
  const [ret] = await query(
    `SELECT r.*, s.sale_no, s.sale_date FROM sales_returns r LEFT JOIN sales s ON s.id = r.sale_id
      WHERE r.id = ? AND r.clinic_id = ?`, [id, clinicId],
  );
  if (!ret) throw notFound('Sales Return');
  ret.lines = await query('SELECT * FROM sales_return_items WHERE sales_return_id = ? ORDER BY id', [id]);
  return ret;
}

// GET /api/sales-returns/sales?q= – sales to return from (newest first, at most 50)
router.get('/sales', async (req, res) => {
  const where = ['s.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(s.sale_no LIKE ? OR s.customer_name LIKE ? OR s.mobile LIKE ?)');
    params.push(...Array(3).fill(like(req.query.q)));
  }
  const rows = await query(
    `SELECT TOP 50 s.id, s.sale_no, s.sale_date, s.customer_name, s.mobile, s.total_amount FROM sales s
      WHERE ${where.join(' AND ')} ORDER BY s.sale_date DESC, s.id DESC`, params,
  );
  res.json({ rows });
});

// GET /api/sales-returns/sale/:saleId?except= – the sale and its lines (sold, already returned)
router.get('/sale/:saleId', async (req, res) => {
  const saleId = toId(req.params.saleId);
  const [sale] = await query('SELECT id, sale_no, sale_date, customer_name, mobile, disc_percent FROM sales WHERE id = ? AND clinic_id = ?', [saleId, req.clinicId]);
  if (!sale) throw notFound('Sale');
  const except = req.query.except ? toId(req.query.except) : 0;
  res.json({ ...sale, lines: await saleLines(query, req.clinicId, saleId, except) });
});

// GET /api/sales-returns?q=&page= – newest first
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['r.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push(`(r.return_no LIKE ? OR s.sale_no LIKE ? OR r.customer_name LIKE ? OR r.mobile LIKE ?
                 OR EXISTS (SELECT 1 FROM sales_return_items i WHERE i.sales_return_id = r.id AND i.item_name LIKE ?))`);
    params.push(...Array(5).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const from = 'FROM sales_returns r LEFT JOIN sales s ON s.id = r.sale_id';
  const [{ total, amount }] = await query(`SELECT COUNT(*) AS total, SUM(r.total_amount) AS amount ${from} WHERE ${w}`, params);
  const rows = await query(
    `SELECT r.id, r.return_no, r.return_date, r.customer_name, r.mobile, r.total_amount, s.sale_no,
            (SELECT STRING_AGG(i.item_name, ', ') WITHIN GROUP (ORDER BY i.id) FROM sales_return_items i WHERE i.sales_return_id = r.id) AS item_names,
            (SELECT SUM(i.unit_qty) FROM sales_return_items i WHERE i.sales_return_id = r.id) AS total_qty
       ${from} WHERE ${w} ORDER BY r.return_date DESC, r.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit, amount: r2(amount) });
});

router.get('/:id', async (req, res) => {
  res.json(await loadReturn(req.clinicId, toId(req.params.id)));
});

// POST /api/sales-returns { sale_id, return_date, lines: [{ sale_item_id, qty }] } – qty in the line's Sell by unit
router.post('/', async (req, res) => {
  const id = await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const { head, lines } = await clean(q, req.body, req.clinicId);
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const no = formatSalesReturnNo(clinic.code, await nextSequence(q, req.clinicId, 'sales_return'));
    const retId = await insertRow(q, 'sales_returns', { ...head, return_no: no, clinic_id: req.clinicId, created_by: req.user.id });
    await applyLines(q, req.clinicId, req.user.id, retId, no, [], lines);
    return retId;
  });
  res.status(201).json(await loadReturn(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const [ret] = await q('SELECT return_no, sale_id FROM sales_returns WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!ret) throw notFound('Sales Return');
    if (Number(req.body?.sale_id) !== ret.sale_id) throw badRequest('The sale of a saved return cannot be changed', 'VALIDATION');
    const { head, lines } = await clean(q, req.body, req.clinicId, id);
    const old = await q('SELECT item_id, qty, stock_in_item_id FROM sales_return_items WHERE sales_return_id = ?', [id]);
    await q(
      `UPDATE sales_returns SET return_date = ?, sub_total = ?, discount_amount = ?, total_amount = ?, updated_at = NOW() WHERE id = ?`,
      [head.return_date, head.sub_total, head.discount_amount, head.total_amount, id],
    );
    await applyLines(q, req.clinicId, req.user.id, id, ret.return_no, old, lines);
  });
  res.json(await loadReturn(req.clinicId, id));
});

// DELETE /api/sales-returns/:id – Admin only; takes the returned packs back out of stock
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Only an Admin can delete a Sales Return');
  const id = toId(req.params.id);
  await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const [ret] = await q('SELECT return_no FROM sales_returns WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!ret) throw notFound('Sales Return');
    const old = await q('SELECT item_id, qty, stock_in_item_id FROM sales_return_items WHERE sales_return_id = ?', [id]);
    await applyLines(q, req.clinicId, req.user.id, id, ret.return_no, old, []);
    await q('DELETE FROM sales_returns WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

export default router;
