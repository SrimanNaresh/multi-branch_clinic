// Pharmacy: Item + Item List + stock in / adjustment
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, oneOf, paging, pick, requireFields, setClause, toAmount, toId, like } from '../../utils/http.js';

const router = Router();
router.use(clinicScope());

const FIELDS = ['name', 'category', 'unit', 'price', 'gst_percent', 'reorder_level', 'pharmacy_id', 'status',
  'item_type', 'hsn_code', 'manufacturer', 'generic_name', 'brand_name', 'purchase_rate', 'mrp', 'discount_percent',
  'schedule_h', 'schedule_h1'];
const TEXT = { item_type: 50, hsn_code: 20, manufacturer: 150, generic_name: 150, brand_name: 150, category: 100, unit: 30 };

async function clean(body, clinicId, userId) {
  const data = pick(body, FIELDS);
  for (const f of ['price', 'gst_percent', 'reorder_level', 'purchase_rate', 'mrp', 'discount_percent']) if (f in data) data[f] = toAmount(data[f], f);
  for (const [f, max] of Object.entries(TEXT)) {
    if (f in data) data[f] = data[f] == null || String(data[f]).trim() === '' ? null : String(data[f]).trim().slice(0, max);
  }
  if (data.unit === null) delete data.unit;
  for (const f of ['schedule_h', 'schedule_h1']) if (f in data) data[f] = data[f] ? 1 : 0;
  if (data.gst_percent > 28) throw badRequest('GST % looks wrong', 'VALIDATION');
  if (data.discount_percent > 100) throw badRequest('Discount % must be 0–100', 'VALIDATION');
  if (data.mrp > 0 && data.price > data.mrp) throw badRequest('Sell price cannot be more than MRP', 'VALIDATION');
  if (data.hsn_code && !/^[0-9A-Za-z]{2,20}$/.test(data.hsn_code)) throw badRequest('HSN code: letters and digits only', 'VALIDATION');
  // Supplier: pick an existing one by id, or type a new name and it is added to Suppliers
  if ('supplier_id' in body || 'supplier_name' in body) {
    data.supplier_id = await resolveSupplier(body, clinicId, userId);
  }
  oneOf(data.status, ['active', 'inactive'], 'status');
  if (data.pharmacy_id) {
    const [ph] = await query('SELECT id FROM pharmacies WHERE id = ? AND clinic_id = ?', [toId(data.pharmacy_id, 'pharmacy'), clinicId]);
    if (!ph) throw badRequest('Pharmacy does not belong to this clinic', 'VALIDATION');
  }
  return data;
}

async function resolveSupplier(body, clinicId, userId) {
  if (body.supplier_id) {
    const [s] = await query('SELECT id FROM suppliers WHERE id = ? AND clinic_id = ?', [toId(body.supplier_id, 'supplier'), clinicId]);
    if (!s) throw badRequest('Supplier does not belong to this clinic', 'VALIDATION');
    return s.id;
  }
  const name = String(body.supplier_name || '').trim().slice(0, 150);
  if (!name) return null;
  const [found] = await query('SELECT TOP 1 id FROM suppliers WHERE clinic_id = ? AND name = ?', [clinicId, name]);
  if (found) return found.id;
  return insertRow(query, 'suppliers', { clinic_id: clinicId, name, created_by: userId });
}

const getItem = async (clinicId, id) =>
  (await query(
    `SELECT i.*, ph.name AS pharmacy_name, s.name AS supplier_name
       FROM items i LEFT JOIN pharmacies ph ON ph.id = i.pharmacy_id LEFT JOIN suppliers s ON s.id = i.supplier_id
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
      WHERE ${w} ORDER BY i.name ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

// GET /api/items/options – values already used in this clinic, for the "select or add" fields
router.get('/options', requirePermission('item.view'), async (req, res) => {
  const distinct = async (col) => (await query(
    `SELECT DISTINCT ${col} AS v FROM items WHERE clinic_id = ? AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`, [req.clinicId],
  )).map((r) => r.v);
  const [types, categories, manufacturers, generics, units] = await Promise.all(
    ['item_type', 'category', 'manufacturer', 'generic_name', 'unit'].map(distinct),
  );
  const suppliers = await query("SELECT id, name FROM suppliers WHERE clinic_id = ? AND status = 'active' ORDER BY name", [req.clinicId]);
  res.json({ types, categories, manufacturers, generics, units, suppliers });
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
  const data = await clean(req.body, req.clinicId, req.user.id);
  requireFields(data, ['name']);
  const opening = toAmount(req.body?.opening_stock, 'opening_stock');
  const id = await tx(async (q) => {
    const itemId = await insertRow(q, 'items', { unit: 'nos', ...data, stock_qty: opening, clinic_id: req.clinicId, created_by: req.user.id });
    if (opening > 0) {
      await insertRow(q, 'stock_movements', {
        clinic_id: req.clinicId, item_id: itemId, qty_change: opening, balance_after: opening,
        reason: 'opening', created_by: req.user.id,
      });
    }
    return itemId;
  });
  res.status(201).json(await getItem(req.clinicId, id));
});

// PUT /api/items/:id – details only; stock changes go through /stock
router.put('/:id', requirePermission('item.manage'), async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(await clean(req.body, req.clinicId, req.user.id));
  const r = await query(`UPDATE items SET ${sql}, updated_at = NOW() WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
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
    const [item] = await q('SELECT stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!item) throw notFound('Item');
    if (supplierId) {
      const [s] = await q('SELECT id FROM suppliers WHERE id = ? AND clinic_id = ?', [supplierId, req.clinicId]);
      if (!s) throw badRequest('Supplier not found in this clinic', 'VALIDATION');
    }
    const balance = Math.round((Number(item.stock_qty) + qty) * 100) / 100;
    if (balance < 0) throw badRequest(`Stock cannot go below zero (current ${item.stock_qty})`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, id]);
    await insertRow(q, 'stock_movements', {
      clinic_id: req.clinicId, item_id: id, qty_change: qty, balance_after: balance, reason,
      supplier_id: supplierId, note: req.body?.note || null, created_by: req.user.id,
    });
  });
  res.json(await getItem(req.clinicId, id));
});

router.get('/:id/movements', requirePermission('item.view'), async (req, res) => {
  const rows = await query(
    `SELECT TOP 200 m.*, s.name AS supplier_name, e.name AS created_by_name
       FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id LEFT JOIN employees e ON e.id = m.created_by
      WHERE m.item_id = ? AND m.clinic_id = ? ORDER BY m.id DESC`,
    [toId(req.params.id), req.clinicId],
  );
  res.json({ rows });
});

export default router;
