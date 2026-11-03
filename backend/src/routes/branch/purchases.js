// Pharmacy → Purchase / Order: orders placed with a vendor (Master = add / edit, List = all orders).
// An order does not change stock. Every sum is worked out again here from the lines (shared/purchase.js).
// Only an Admin may delete an order, and not once a Stock In is made for it.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, forbidden, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatPurchaseNo } from '../../utils/codes.js';
import { calcLine } from '../../../../shared/purchase.js';
import { isAdmin } from '../../utils/stock.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const MAX_LINES = 200;
const ITEM_COPY = ['generic_name', 'hsn_code', 'manufacturer', 'category', 'pack', 'unit'];

/** Checks the order and its lines; each line takes the item's details from the item itself. */
async function clean(body, clinicId) {
  const supplierId = toId(body?.supplier_id, 'vendor');
  const [s] = await query('SELECT id FROM suppliers WHERE id = ? AND clinic_id = ?', [supplierId, clinicId]);
  if (!s) throw badRequest('Choose a vendor', 'VALIDATION');
  const poDate = body?.po_date || todayISO();
  if (!isISODate(poDate)) throw badRequest('Invalid date', 'VALIDATION');
  const details = String(body?.details ?? '').trim().slice(0, 1000) || null;

  const input = Array.isArray(body?.lines) ? body.lines.filter((l) => l?.item_id) : [];
  if (!input.length) throw badRequest('Add at least one item', 'VALIDATION');
  if (input.length > MAX_LINES) throw badRequest(`At most ${MAX_LINES} items per order`, 'VALIDATION');
  const ids = [...new Set(input.map((l) => toId(l.item_id, 'item')))];
  const items = await query(
    `SELECT id, name, ${ITEM_COPY.join(', ')} FROM items WHERE clinic_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    [clinicId, ...ids],
  );
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines = input.map((l, n) => {
    const item = byId.get(Number(l.item_id));
    if (!item) throw badRequest(`Line ${n + 1}: item not found`, 'VALIDATION');
    const v = {
      mrp: toAmount(l.mrp, 'MRP'), p_rate: toAmount(l.p_rate, 'P.Rate'), free_qty: toAmount(l.free_qty, 'Free'),
      disc_percent: toAmount(l.disc_percent, 'Disc %'), qty: toAmount(l.qty, 'quantity'),
      cgst_percent: toAmount(l.cgst_percent, 'CGST %'), sgst_percent: toAmount(l.sgst_percent, 'SGST %'),
    };
    if (v.disc_percent > 100) throw badRequest(`Line ${n + 1}: Disc % must be 0–100`, 'VALIDATION');
    if (v.mrp > 0 && v.p_rate > v.mrp) throw badRequest(`${item.name}: P.Rate ${v.p_rate.toFixed(2)} is more than MRP ${v.mrp.toFixed(2)}`, 'VALIDATION');
    if (v.cgst_percent + v.sgst_percent > 28) throw badRequest(`Line ${n + 1}: GST % looks wrong`, 'VALIDATION');
    if (v.qty <= 0) throw badRequest(`Line ${n + 1}: enter the quantity`, 'VALIDATION');
    return {
      item_id: item.id, item_name: item.name,
      ...Object.fromEntries(ITEM_COPY.map((k) => [k, item[k] ?? null])),
      ...v, ...calcLine(v),
    };
  });
  const total = Math.round(lines.reduce((sum, l) => sum + l.total, 0) * 100) / 100;
  return { order: { supplier_id: supplierId, po_date: poDate, details, total_amount: total }, lines };
}

const saveLines = async (q, clinicId, poId, lines) => {
  await q('DELETE FROM purchase_order_items WHERE po_id = ? AND clinic_id = ?', [poId, clinicId]);
  for (const l of lines) await insertRow(q, 'purchase_order_items', { clinic_id: clinicId, po_id: poId, ...l });
};

async function loadOrder(clinicId, id) {
  const [po] = await query(
    `SELECT p.*, s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ? AND p.clinic_id = ?`, [id, clinicId],
  );
  if (!po) throw notFound('Purchase order');
  po.lines = await query('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id', [id]);
  return po;
}

// GET /api/purchases?q=&supplier_id=&page= – newest first
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['p.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.supplier_id) {                      // Stock In: one vendor's orders
    where.push('p.supplier_id = ?');
    params.push(toId(req.query.supplier_id, 'vendor'));
  }
  if (req.query.open === '1') {                     // Stock In: leave out orders already fully received
    where.push(`(p.id = ? OR EXISTS (SELECT 1 FROM purchase_order_items l WHERE l.po_id = p.id
      AND l.qty + l.free_qty > COALESCE((SELECT SUM(x.qty + x.free_qty) FROM stock_in_items x WHERE x.po_item_id = l.id), 0)))`);
    params.push(req.query.include ? toId(req.query.include) : 0);   // the order of the Stock In being edited
  }
  if (req.query.q) {
    where.push('(p.po_no LIKE ? OR s.name LIKE ?)');
    params.push(like(req.query.q), like(req.query.q));
  }
  const w = where.join(' AND ');
  const from = 'FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} WHERE ${w}`, params);
  const rows = await query(
    `SELECT p.id, p.po_no, p.po_date, p.total_amount, s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = p.id) AS item_count
       ${from} WHERE ${w} ORDER BY p.po_date DESC, p.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

// GET /api/purchases/old-prices?supplier_id=&item_ids=1,2 – Old Price: this vendor's last net rate for each item
router.get('/old-prices', async (req, res) => {
  const supplierId = toId(req.query.supplier_id, 'vendor');
  const ids = [...new Set(String(req.query.item_ids || '').split(',').filter(Boolean).map((v) => toId(v, 'item')))].slice(0, MAX_LINES);
  if (!ids.length) { res.json({}); return; }
  const rows = await query(
    `SELECT x.item_id, x.rate FROM (
       SELECT l.item_id, l.rate, ROW_NUMBER() OVER (PARTITION BY l.item_id ORDER BY p.po_date DESC, p.id DESC) AS n
         FROM purchase_order_items l JOIN purchase_orders p ON p.id = l.po_id
        WHERE p.clinic_id = ? AND p.supplier_id = ? AND l.item_id IN (${ids.map(() => '?').join(', ')})${req.query.except ? ' AND p.id <> ?' : ''}
     ) x WHERE x.n = 1`,
    [req.clinicId, supplierId, ...ids, ...(req.query.except ? [toId(req.query.except)] : [])],
  );
  res.json(Object.fromEntries(rows.map((r) => [r.item_id, Number(r.rate)])));
});

router.get('/:id', async (req, res) => {
  res.json(await loadOrder(req.clinicId, toId(req.params.id)));
});

// POST /api/purchases { supplier_id, po_date, details, lines: [{ item_id, mrp, p_rate, free_qty, disc_percent, qty, cgst_percent, sgst_percent }] }
router.post('/', async (req, res) => {
  const { order, lines } = await clean(req.body, req.clinicId);
  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const n = await nextSequence(q, req.clinicId, 'purchase');
    const poId = await insertRow(q, 'purchase_orders', {
      ...order, po_no: formatPurchaseNo(clinic.code, n), clinic_id: req.clinicId, created_by: req.user.id,
    });
    await saveLines(q, req.clinicId, poId, lines);
    return poId;
  });
  res.status(201).json(await loadOrder(req.clinicId, id));
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { order, lines } = await clean(req.body, req.clinicId);
  await tx(async (q) => {
    // once goods are received against it (Stock In), the order's lines are fixed
    const [received] = await q('SELECT TOP 1 si_no FROM stock_ins WHERE po_id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (received) throw badRequest(`Stock In ${received.si_no} is already made for this order – it can no longer be changed`, 'VALIDATION');
    const r = await q(
      'UPDATE purchase_orders SET supplier_id = ?, po_date = ?, details = ?, total_amount = ?, updated_at = NOW() WHERE id = ? AND clinic_id = ?',
      [order.supplier_id, order.po_date, order.details, order.total_amount, id, req.clinicId],
    );
    if (!r.affectedRows) throw notFound('Purchase order');
    await saveLines(q, req.clinicId, id, lines);
  });
  res.json(await loadOrder(req.clinicId, id));
});

// DELETE /api/purchases/:id – Admin only, and only while no Stock In is made for the order
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Only an Admin can delete an order');
  const id = toId(req.params.id);
  await tx(async (q) => {
    const [po] = await q('SELECT id FROM purchase_orders WITH (UPDLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!po) throw notFound('Purchase order');
    const [received] = await q('SELECT TOP 1 si_no FROM stock_ins WHERE po_id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (received) throw badRequest(`Stock In ${received.si_no} is made for this order – it can't be deleted`, 'VALIDATION');
    await q('DELETE FROM purchase_order_items WHERE po_id = ?', [id]);
    await q('DELETE FROM purchase_orders WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

export default router;
