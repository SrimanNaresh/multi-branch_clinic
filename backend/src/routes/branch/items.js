// Pharmacy: Item + Item List + stock in / adjustment
import { Router } from '../../lib/mini-express.js';
import { query, tx } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, oneOf, paging, pick, requireFields, setClause, toAmount, toId, like } from '../../utils/http.js';

const router = Router();
router.use(clinicScope());

const FIELDS = ['name', 'category', 'unit', 'price', 'gst_percent', 'reorder_level', 'pharmacy_id', 'status'];

async function clean(body, clinicId) {
  const data = pick(body, FIELDS);
  for (const f of ['price', 'gst_percent', 'reorder_level']) if (f in data) data[f] = toAmount(data[f], f);
  if (data.gst_percent > 28) throw badRequest('GST % looks wrong', 'VALIDATION');
  oneOf(data.status, ['active', 'inactive'], 'status');
  if (data.pharmacy_id) {
    const [ph] = await query('SELECT id FROM pharmacies WHERE id = ? AND clinic_id = ?', [toId(data.pharmacy_id, 'pharmacy'), clinicId]);
    if (!ph) throw badRequest('Pharmacy does not belong to this clinic', 'VALIDATION');
  }
  return data;
}

const getItem = async (clinicId, id) =>
  (await query(
    `SELECT i.*, ph.name AS pharmacy_name FROM items i LEFT JOIN pharmacies ph ON ph.id = i.pharmacy_id
      WHERE i.id = ? AND i.clinic_id = ?`, [id, clinicId],
  ))[0];

// GET /api/items?q=&category=&low_stock=1&status=&page=
router.get('/', requirePermission('item.view'), async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 200 });
  const where = ['i.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(i.name LIKE ? OR i.category LIKE ?)');
    params.push(like(req.query.q), like(req.query.q));
  }
  if (req.query.category) {
    where.push('i.category = ?');
    params.push(req.query.category);
  }
  if (req.query.status) {
    where.push('i.status = ?');
    params.push(req.query.status);
  }
  if (req.query.low_stock === '1') where.push('i.stock_qty <= i.reorder_level');
  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM items i WHERE ${w}`, params);
  const rows = await query(
    `SELECT i.*, ph.name AS pharmacy_name FROM items i LEFT JOIN pharmacies ph ON ph.id = i.pharmacy_id
      WHERE ${w} ORDER BY i.name LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ rows, total, page, limit });
});

router.get('/categories', requirePermission('item.view'), async (req, res) => {
  const rows = await query(
    'SELECT DISTINCT category FROM items WHERE clinic_id = ? AND category IS NOT NULL ORDER BY category',
    [req.clinicId],
  );
  res.json({ rows: rows.map((r) => r.category) });
});

router.get('/:id', requirePermission('item.view'), async (req, res) => {
  const item = await getItem(req.clinicId, toId(req.params.id));
  if (!item) throw notFound('Item');
  res.json(item);
});

// POST /api/items  { name, category, unit, price, gst_percent, reorder_level, opening_stock, pharmacy_id }
router.post('/', requirePermission('item.manage'), async (req, res) => {
  const data = await clean(req.body, req.clinicId);
  requireFields(data, ['name']);
  const opening = toAmount(req.body?.opening_stock, 'opening_stock');
  const id = await tx(async (q) => {
    const r = await q('INSERT INTO items SET ?', [{ unit: 'nos', ...data, stock_qty: opening, clinic_id: req.clinicId, created_by: req.user.id }]);
    if (opening > 0) {
      await q('INSERT INTO stock_movements SET ?', [{
        clinic_id: req.clinicId, item_id: r.insertId, qty_change: opening, balance_after: opening,
        reason: 'opening', created_by: req.user.id,
      }]);
    }
    return r.insertId;
  });
  res.status(201).json(await getItem(req.clinicId, id));
});

// PUT /api/items/:id – details only; stock changes go through /stock
router.put('/:id', requirePermission('item.manage'), async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(await clean(req.body, req.clinicId));
  const r = await query(`UPDATE items SET ${sql} WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Item');
  res.json(await getItem(req.clinicId, id));
});

// POST /api/items/:id/stock  { qty, reason: purchase|adjustment|return, supplier_id?, note? }
// qty is positive for stock in; adjustment may be negative.
router.post('/:id/stock', requirePermission('stock.manage'), async (req, res) => {
  const id = toId(req.params.id);
  const reason = req.body?.reason || 'purchase';
  oneOf(reason, ['purchase', 'adjustment', 'return'], 'reason');
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty === 0) throw badRequest('Enter a quantity', 'VALIDATION');
  if (reason !== 'adjustment' && qty < 0) throw badRequest('Quantity must be positive', 'VALIDATION');
  const supplierId = req.body?.supplier_id ? toId(req.body.supplier_id, 'supplier') : null;

  await tx(async (q) => {
    const [item] = await q('SELECT stock_qty FROM items WHERE id = ? AND clinic_id = ? FOR UPDATE', [id, req.clinicId]);
    if (!item) throw notFound('Item');
    if (supplierId) {
      const [s] = await q('SELECT id FROM suppliers WHERE id = ? AND clinic_id = ?', [supplierId, req.clinicId]);
      if (!s) throw badRequest('Supplier not found in this clinic', 'VALIDATION');
    }
    const balance = Math.round((Number(item.stock_qty) + qty) * 100) / 100;
    if (balance < 0) throw badRequest(`Stock cannot go below zero (current ${item.stock_qty})`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ? WHERE id = ?', [balance, id]);
    await q('INSERT INTO stock_movements SET ?', [{
      clinic_id: req.clinicId, item_id: id, qty_change: qty, balance_after: balance, reason,
      supplier_id: supplierId, note: req.body?.note || null, created_by: req.user.id,
    }]);
  });
  res.json(await getItem(req.clinicId, id));
});

router.get('/:id/movements', requirePermission('item.view'), async (req, res) => {
  const rows = await query(
    `SELECT m.*, s.name AS supplier_name, e.name AS created_by_name
       FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id LEFT JOIN employees e ON e.id = m.created_by
      WHERE m.item_id = ? AND m.clinic_id = ? ORDER BY m.id DESC LIMIT 200`,
    [toId(req.params.id), req.clinicId],
  );
  res.json({ rows });
});

export default router;
