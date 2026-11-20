// Pharmacy → Stock In → Adjustment: corrections and opening stock. Each line adds (In) and / or takes out (Out)
// packs of an item, in one of its batches (a Stock In line) or in the item's stock with no batch.
// In Price / Out Price start at the item's purchase rate; In Total = Σ In Qty × In Price, Out Total likewise.
// Stock moves by In − Out (stock_movements, reason 'adjustment', ref_type 'stock_adjustment'); neither the item
// nor a batch may go below zero. An edit applies only the change. Only an Admin may delete an adjustment.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, forbidden, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatAdjustmentNo } from '../../utils/codes.js';
import { assertBatchesNotNegative, batchLeftSql, isAdmin, lockStock, moveItemStock, r4 } from '../../utils/stock.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.adjust'));

const MAX_LINES = 200;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const qty4 = (v, field) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`Invalid ${field}`, 'VALIDATION');
  return r4(n);
};

/** The item's stock and its batches with the packs left (`exceptId`'s own lines left out). */
async function itemStock(q, clinicId, itemId, exceptId = 0) {
  const [item] = await q('SELECT id, name, stock_qty, purchase_rate, mrp, unit FROM items WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
  if (!item) return null;
  const batches = await q(
    `SELECT l.id AS stock_in_item_id, l.batch_no, l.exp_date, l.rate, l.mrp, si.si_no, ${batchLeftSql('l')} AS left_qty
       FROM stock_in_items l JOIN stock_ins si ON si.id = l.stock_in_id
      WHERE l.item_id = ? AND l.clinic_id = ?
      ORDER BY CASE WHEN l.exp_date IS NULL THEN 1 ELSE 0 END, l.exp_date, l.id`,
    [0, 0, exceptId, itemId, clinicId],
  );
  return { ...item, batches: batches.map((b) => ({ ...b, left_qty: r4(b.left_qty) })) };
}

/** Checks the adjustment and its lines; lines with no In and no Out are left out. */
async function clean(q, body, clinicId, exceptId = 0) {
  const date = body?.adj_date || todayISO();
  if (!isISODate(date)) throw badRequest('Invalid date', 'VALIDATION');
  if (date > todayISO()) throw badRequest('Date cannot be in the future', 'VALIDATION');
  const remarks = String(body?.remarks ?? '').trim().slice(0, 300) || null;
  const input = Array.isArray(body?.lines) ? body.lines.filter((l) => l?.item_id) : [];
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} lines`, 'VALIDATION');
  const cache = new Map();
  const lines = [];
  for (const l of input) {
    const inQty = qty4(l.in_qty, 'In Qty');
    const outQty = qty4(l.out_qty, 'Out Qty');
    if (!inQty && !outQty) continue;
    const itemId = toId(l.item_id, 'item');
    if (!cache.has(itemId)) cache.set(itemId, await itemStock(q, clinicId, itemId, exceptId));
    const item = cache.get(itemId);
    if (!item) throw badRequest('Item not found', 'VALIDATION');
    let batch = null;
    if (l.stock_in_item_id) {
      batch = item.batches.find((b) => b.stock_in_item_id === Number(l.stock_in_item_id));
      if (!batch) throw badRequest(`${item.name}: that batch is not this item's`, 'VALIDATION');
    }
    const rate = Number(batch?.rate ?? item.purchase_rate ?? 0);
    lines.push({
      item_id: item.id, item_name: item.name, stock_in_item_id: batch?.stock_in_item_id || null, batch_no: batch?.batch_no || null,
      cur_stock: batch ? batch.left_qty : r4(item.stock_qty),
      in_qty: inQty, in_price: l.in_price === '' || l.in_price == null ? rate : toAmount(l.in_price, 'In Price'),
      out_qty: outQty, out_price: l.out_price === '' || l.out_price == null ? rate : toAmount(l.out_price, 'Out Price'),
      mrp: Number(batch?.mrp ?? item.mrp ?? 0) || null,
    });
  }
  if (!lines.length) throw badRequest('Enter In or Out quantity for at least one item', 'VALIDATION');
  return {
    head: {
      adj_date: date, remarks,
      in_total: r2(lines.reduce((s, l) => s + l.in_qty * l.in_price, 0)),
      out_total: r2(lines.reduce((s, l) => s + l.out_qty * l.out_price, 0)),
    },
    lines,
  };
}

/** Saves the lines: stock moves by (new − old) In − Out per item; items and batches never go below zero. */
async function applyLines(q, clinicId, userId, id, no, oldLines, lines) {
  const change = new Map();
  for (const l of oldLines) change.set(l.item_id, (change.get(l.item_id) || 0) - Number(l.in_qty) + Number(l.out_qty));
  for (const l of lines) change.set(l.item_id, (change.get(l.item_id) || 0) + l.in_qty - l.out_qty);
  await moveItemStock(q, clinicId, userId, change, {
    reason: 'adjustment', ref_type: 'stock_adjustment', ref_id: id,
    note: !oldLines.length ? `Adjustment ${no}` : lines.length ? `Adjustment ${no} changed` : `Adjustment ${no} deleted`,
  });
  await q('DELETE FROM stock_adjustment_items WHERE adjustment_id = ? AND clinic_id = ?', [id, clinicId]);
  for (const l of lines) await insertRow(q, 'stock_adjustment_items', { clinic_id: clinicId, adjustment_id: id, ...l });
  await assertBatchesNotNegative(q, clinicId, [...oldLines, ...lines].map((l) => l.stock_in_item_id));
}

async function loadAdjustment(clinicId, id) {
  const [adj] = await query('SELECT * FROM stock_adjustments WHERE id = ? AND clinic_id = ?', [id, clinicId]);
  if (!adj) throw notFound('Adjustment');
  adj.lines = await query('SELECT * FROM stock_adjustment_items WHERE adjustment_id = ? ORDER BY id', [id]);
  return adj;
}

// GET /api/stock-adjustments/item/:itemId?except= – the item's stock and batches (packs left in each)
router.get('/item/:itemId', async (req, res) => {
  const except = req.query.except ? toId(req.query.except) : 0;
  const item = await itemStock(query, req.clinicId, toId(req.params.itemId), except);
  if (!item) throw notFound('Item');
  res.json(item);
});

// GET /api/stock-adjustments?q=&page= – newest first
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['a.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push(`(a.adj_no LIKE ? OR a.remarks LIKE ?
                 OR EXISTS (SELECT 1 FROM stock_adjustment_items i WHERE i.adjustment_id = a.id AND (i.item_name LIKE ? OR i.batch_no LIKE ?)))`);
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM stock_adjustments a WHERE ${w}`, params);
  const rows = await query(
    `SELECT a.id, a.adj_no, a.adj_date, a.remarks, a.in_total, a.out_total,
            (SELECT STRING_AGG(i.item_name, ', ') WITHIN GROUP (ORDER BY i.id) FROM stock_adjustment_items i WHERE i.adjustment_id = a.id) AS item_names,
            (SELECT SUM(i.in_qty) FROM stock_adjustment_items i WHERE i.adjustment_id = a.id) AS in_qty,
            (SELECT SUM(i.out_qty) FROM stock_adjustment_items i WHERE i.adjustment_id = a.id) AS out_qty
       FROM stock_adjustments a WHERE ${w} ORDER BY a.adj_date DESC, a.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

router.get('/:id', async (req, res) => {
  res.json(await loadAdjustment(req.clinicId, toId(req.params.id)));
});

// POST /api/stock-adjustments { adj_date, remarks, lines: [{ item_id, stock_in_item_id?, in_qty, in_price, out_qty, out_price }] }
router.post('/', async (req, res) => {
  const id = await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const { head, lines } = await clean(q, req.body, req.clinicId);
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const no = formatAdjustmentNo(clinic.code, await nextSequence(q, req.clinicId, 'adjustment'));
    const adjId = await insertRow(q, 'stock_adjustments', { ...head, adj_no: no, clinic_id: req.clinicId, created_by: req.user.id });
    await applyLines(q, req.clinicId, req.user.id, adjId, no, [], lines);
    return adjId;
  });
  res.status(201).json(await loadAdjustment(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const [adj] = await q('SELECT adj_no FROM stock_adjustments WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!adj) throw notFound('Adjustment');
    const { head, lines } = await clean(q, req.body, req.clinicId, id);
    const old = await q('SELECT item_id, stock_in_item_id, in_qty, out_qty FROM stock_adjustment_items WHERE adjustment_id = ?', [id]);
    await q('UPDATE stock_adjustments SET adj_date = ?, remarks = ?, in_total = ?, out_total = ?, updated_at = NOW() WHERE id = ?',
      [head.adj_date, head.remarks, head.in_total, head.out_total, id]);
    await applyLines(q, req.clinicId, req.user.id, id, adj.adj_no, old, lines);
  });
  res.json(await loadAdjustment(req.clinicId, id));
});

// DELETE /api/stock-adjustments/:id – Admin only; undoes its stock moves
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Only an Admin can delete an adjustment');
  const id = toId(req.params.id);
  await tx(async (q) => {
    await lockStock(q, req.clinicId);
    const [adj] = await q('SELECT adj_no FROM stock_adjustments WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!adj) throw notFound('Adjustment');
    const old = await q('SELECT item_id, stock_in_item_id, in_qty, out_qty FROM stock_adjustment_items WHERE adjustment_id = ?', [id]);
    await applyLines(q, req.clinicId, req.user.id, id, adj.adj_no, old, []);
    await q('DELETE FROM stock_adjustments WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

export default router;
