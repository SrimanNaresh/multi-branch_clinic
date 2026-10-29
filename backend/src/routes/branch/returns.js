// Pharmacy → Return: goods sent back to the vendor, taken from one of its Stock Ins.
// Saving takes each line's quantity out of the item's stock (logged in stock_movements, reason 'return').
// A line cannot return more than its Stock In line received, less what earlier Returns took back.
// An edit applies only the change in quantity.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatReturnNo } from '../../utils/codes.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const MAX_LINES = 200;
const r2 = (n) => Math.round(n * 100) / 100;

/** The Stock In's lines with what earlier Returns (other than `exceptId`) already took back. */
async function stockInLines(clinicId, siId, exceptId = 0) {
  return query(
    `SELECT l.id AS stock_in_item_id, l.item_id, l.item_name, l.batch_no, l.mfg_date, l.exp_date, l.rate, l.qty AS received,
            COALESCE((SELECT SUM(r.qty) FROM purchase_return_items r WHERE r.stock_in_item_id = l.id AND r.return_id <> ?), 0) AS returned
       FROM stock_in_items l WHERE l.stock_in_id = ? AND l.clinic_id = ? ORDER BY l.id`,
    [exceptId, siId, clinicId],
  );
}

/** Checks the Return and its lines against the chosen Stock In; lines with no quantity are left out. */
async function clean(body, clinicId, exceptId = 0) {
  const supplierId = toId(body?.supplier_id, 'vendor');
  const siId = toId(body?.stock_in_id, 'Stock In');
  const [si] = await query('SELECT id, supplier_id FROM stock_ins WHERE id = ? AND clinic_id = ?', [siId, clinicId]);
  if (!si) throw badRequest('Choose a Stock In', 'VALIDATION');
  if (si.supplier_id !== supplierId) throw badRequest('That Stock In is from another vendor', 'VALIDATION');
  const date = body?.return_date || todayISO();
  if (!isISODate(date)) throw badRequest('Invalid date', 'VALIDATION');

  const byLine = new Map((await stockInLines(clinicId, siId, exceptId)).map((l) => [l.stock_in_item_id, l]));
  const input = Array.isArray(body?.lines) ? body.lines : [];
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} lines`, 'VALIDATION');
  const lines = [];
  for (const [n, l] of input.entries()) {
    const qty = toAmount(l?.qty, 'quantity');
    if (!qty) continue;
    const src = byLine.get(Number(l.stock_in_item_id));
    if (!src) throw badRequest(`Line ${n + 1}: not on this Stock In`, 'VALIDATION');
    const left = r2(Number(src.received) - Number(src.returned));
    if (qty > left) throw badRequest(`${src.item_name} (batch ${src.batch_no || '—'}): only ${left} can be returned`, 'VALIDATION');
    const rate = Number(src.rate);
    lines.push({
      stock_in_item_id: src.stock_in_item_id, item_id: src.item_id, item_name: src.item_name,
      batch_no: src.batch_no, mfg_date: src.mfg_date, exp_date: src.exp_date, qty, rate, amount: r2(qty * rate),
    });
  }
  if (!lines.length) throw badRequest('Enter the quantity to return for at least one item', 'VALIDATION');
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { head: { supplier_id: supplierId, stock_in_id: siId, return_date: date, total_amount: total }, lines };
}

/** Saves the lines of a Return: stock goes down by (new − old) quantity per item, never below zero. */
async function applyLines(q, clinicId, userId, retId, retNo, supplierId, oldLines, lines) {
  const change = new Map();
  for (const l of oldLines) change.set(l.item_id, (change.get(l.item_id) || 0) + Number(l.qty));
  for (const l of lines) change.set(l.item_id, (change.get(l.item_id) || 0) - l.qty);
  const isEdit = oldLines.length > 0;
  for (const [itemId, diff] of change) {
    if (!r2(diff)) continue;
    const [item] = await q('SELECT name, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
    const balance = r2(Number(item.stock_qty) + diff);
    if (balance < 0) throw badRequest(`${item.name}: only ${item.stock_qty} in stock – cannot return that many`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, itemId]);
    await insertRow(q, 'stock_movements', {
      clinic_id: clinicId, item_id: itemId, qty_change: r2(diff), balance_after: balance,
      reason: isEdit ? 'adjustment' : 'return', ref_type: 'purchase_return', ref_id: retId, supplier_id: supplierId,
      note: isEdit ? `Return ${retNo} changed` : `Return ${retNo} to vendor`, created_by: userId,
    });
  }
  await q('DELETE FROM purchase_return_items WHERE return_id = ? AND clinic_id = ?', [retId, clinicId]);
  for (const l of lines) await insertRow(q, 'purchase_return_items', { clinic_id: clinicId, return_id: retId, ...l });
}

async function loadReturn(clinicId, id) {
  const [ret] = await query(
    `SELECT r.*, s.name AS supplier_name, si.si_no FROM purchase_returns r
       JOIN suppliers s ON s.id = r.supplier_id JOIN stock_ins si ON si.id = r.stock_in_id
      WHERE r.id = ? AND r.clinic_id = ?`, [id, clinicId],
  );
  if (!ret) throw notFound('Return');
  ret.lines = await query('SELECT * FROM purchase_return_items WHERE return_id = ? ORDER BY id', [id]);
  return ret;
}

// GET /api/returns?q=&page= – newest first, with the item names on each Return
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['r.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push(`(r.return_no LIKE ? OR si.si_no LIKE ? OR s.name LIKE ?
                 OR EXISTS (SELECT 1 FROM purchase_return_items i WHERE i.return_id = r.id AND i.item_name LIKE ?))`);
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const from = 'FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN stock_ins si ON si.id = r.stock_in_id';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} WHERE ${w}`, params);
  const rows = await query(
    `SELECT r.id, r.return_no, r.return_date, r.total_amount, s.name AS supplier_name, si.si_no,
            (SELECT COUNT(*) FROM purchase_return_items i WHERE i.return_id = r.id) AS item_count,
            (SELECT STRING_AGG(i.item_name, ', ') WITHIN GROUP (ORDER BY i.id) FROM purchase_return_items i WHERE i.return_id = r.id) AS item_names,
            (SELECT SUM(i.qty) FROM purchase_return_items i WHERE i.return_id = r.id) AS total_qty
       ${from} WHERE ${w} ORDER BY r.return_date DESC, r.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

// GET /api/returns/stock-in/:siId?except= – the Stock In's lines to return from (received, already returned)
router.get('/stock-in/:siId', async (req, res) => {
  const siId = toId(req.params.siId);
  const [si] = await query('SELECT id FROM stock_ins WHERE id = ? AND clinic_id = ?', [siId, req.clinicId]);
  if (!si) throw notFound('Stock In');
  const except = req.query.except ? toId(req.query.except) : 0;
  res.json({ rows: await stockInLines(req.clinicId, siId, except) });
});

router.get('/:id', async (req, res) => {
  res.json(await loadReturn(req.clinicId, toId(req.params.id)));
});

// POST /api/returns { supplier_id, stock_in_id, return_date, lines: [{ stock_in_item_id, qty }] }
router.post('/', async (req, res) => {
  const { head, lines } = await clean(req.body, req.clinicId);
  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const retNo = formatReturnNo(clinic.code, await nextSequence(q, req.clinicId, 'return'));
    const retId = await insertRow(q, 'purchase_returns', { ...head, return_no: retNo, clinic_id: req.clinicId, created_by: req.user.id });
    await applyLines(q, req.clinicId, req.user.id, retId, retNo, head.supplier_id, [], lines);
    return retId;
  });
  res.status(201).json(await loadReturn(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { head, lines } = await clean(req.body, req.clinicId, id);
  await tx(async (q) => {
    const [ret] = await q('SELECT return_no FROM purchase_returns WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!ret) throw notFound('Return');
    const old = await q('SELECT item_id, qty FROM purchase_return_items WHERE return_id = ?', [id]);
    await q('UPDATE purchase_returns SET supplier_id = ?, stock_in_id = ?, return_date = ?, total_amount = ?, updated_at = NOW() WHERE id = ?',
      [head.supplier_id, head.stock_in_id, head.return_date, head.total_amount, id]);
    await applyLines(q, req.clinicId, req.user.id, id, ret.return_no, head.supplier_id, old, lines);
  });
  res.json(await loadReturn(req.clinicId, id));
});

export default router;
