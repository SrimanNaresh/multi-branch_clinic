// Pharmacy: Item + Item List + stock in / adjustment
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, updateRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, oneOf, paging, pick, requireFields, setClause, toAmount, toId, like } from '../../utils/http.js';
import { checkItemRows, IMPORT_ERRORS, MAX_IMPORT_ROWS } from '../../../../shared/itemImport.js';
import { nextSequence, formatItemCode } from '../../utils/codes.js';

const router = Router();
router.use(clinicScope());

const FIELDS = ['name', 'category', 'unit', 'price', 'reorder_level', 'pharmacy_id', 'status',
  'item_type', 'hsn_code', 'manufacturer', 'generic_name', 'brand_name', 'purchase_rate', 'mrp', 'discount_percent',
  'schedule_h', 'schedule_h1', 'cgst_percent', 'sgst_percent', 'pack', 'rack', 'box'];
const TEXT = { item_type: 50, hsn_code: 20, manufacturer: 150, generic_name: 150, brand_name: 150, category: 100, unit: 30, pack: 50, rack: 50, box: 50 };

async function clean(body, clinicId, userId) {
  const data = pick(body, FIELDS);
  for (const f of ['price', 'reorder_level', 'purchase_rate', 'mrp', 'discount_percent', 'cgst_percent', 'sgst_percent']) if (f in data) data[f] = toAmount(data[f], f);
  for (const [f, max] of Object.entries(TEXT)) {
    if (f in data) data[f] = data[f] == null || String(data[f]).trim() === '' ? null : String(data[f]).trim().slice(0, max);
  }
  if (data.unit === null) delete data.unit;
  for (const f of ['schedule_h', 'schedule_h1']) if (f in data) data[f] = data[f] ? 1 : 0;
  // gst_percent is always the sum of the two – never sent/edited directly, so billing / dispense
  // (which still read i.gst_percent as one number) keep working without any change on their side.
  if ('cgst_percent' in data || 'sgst_percent' in data) {
    data.gst_percent = (data.cgst_percent || 0) + (data.sgst_percent || 0);
  }
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
    where.push('(i.name LIKE ? OR i.category LIKE ? OR i.brand_name LIKE ? OR i.generic_name LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
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

// POST /api/items  { name, category, unit, price, cgst_percent, sgst_percent, reorder_level, opening_stock, pharmacy_id }
router.post('/', requirePermission('item.manage'), async (req, res) => {
  const data = await clean(req.body, req.clinicId, req.user.id);
  requireFields(data, ['name']);
  const opening = toAmount(req.body?.opening_stock, 'opening_stock');
  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const n = await nextSequence(q, req.clinicId, 'item');
    const itemId = await insertRow(q, 'items', {
      unit: 'nos', ...data, item_code: formatItemCode(clinic.code, n), stock_qty: opening, clinic_id: req.clinicId, created_by: req.user.id,
    });
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

// POST /api/items/import { rows: [{ line, data }] } – from the CSV template (Pharmacy → Item → Import).
// Every row is checked first; if any row is wrong nothing is saved and the problems come back per line.
// A row whose Item Name + Unit already exists updates that item (blank cells keep the current value);
// other rows add new items. Stock is never changed here.
router.post('/import', requirePermission('item.manage'), async (req, res) => {
  const input = req.body?.rows;
  if (!Array.isArray(input) || !input.length) throw badRequest('The file has no item rows', 'VALIDATION');
  if (input.length > MAX_IMPORT_ROWS) throw badRequest(`At most ${MAX_IMPORT_ROWS} rows per file`, 'VALIDATION');
  const rows = input.map((r, i) => ({ line: Number(r?.line) || i + 2, data: r?.data && typeof r.data === 'object' ? r.data : {} }));
  const checked = checkItemRows(rows);
  const bad = checked.filter((r) => r.errors.length);
  if (bad.length) {
    const err = badRequest(`${bad.length} row(s) need fixing – nothing was imported`, 'IMPORT_INVALID');
    err.details = bad.map((r) => ({ line: r.line, errors: r.errors.map((e) => ({ ...e, message: IMPORT_ERRORS[e.code] })) }));
    throw err;
  }

  const result = await tx(async (q) => {
    let created = 0;
    let updated = 0;
    const suppliers = new Map();   // name (lower case) → id, so a new supplier is added once
    const supplierId = async (name) => {
      const key = name.toLowerCase();
      if (!suppliers.has(key)) {
        const [found] = await q('SELECT TOP 1 id FROM suppliers WHERE clinic_id = ? AND name = ?', [req.clinicId, name]);
        suppliers.set(key, found ? found.id : await insertRow(q, 'suppliers', { clinic_id: req.clinicId, name, created_by: req.user.id }));
      }
      return suppliers.get(key);
    };

    for (const [i, { data }] of checked.entries()) {
      const { supplier_name: supplierName, ...item } = data;
      if (supplierName) item.supplier_id = await supplierId(supplierName);
      const [existing] = await q('SELECT id FROM items WITH (UPDLOCK, HOLDLOCK) WHERE clinic_id = ? AND name = ? AND unit = ?',
        [req.clinicId, item.name, item.unit]);
      if (existing) {
        // only the cells filled in the file change the item
        const filled = rows[i].data;
        const changes = Object.fromEntries(Object.entries(item).filter(([k]) =>
          k === 'supplier_id' ? !!supplierName : filled[k] !== undefined && String(filled[k]).trim() !== ''));
        delete changes.name;
        delete changes.unit;
        if (Object.keys(changes).length) await updateRow(q, 'items', changes, 'id = ?', [existing.id]);
        updated += 1;
      } else {
        await insertRow(q, 'items', { ...item, clinic_id: req.clinicId, created_by: req.user.id });
        created += 1;
      }
    }
    return { created, updated };
  });
  res.json(result);
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
