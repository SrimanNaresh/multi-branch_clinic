import { Router } from '../../lib/mini-express.js';
import { query, insertRow } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, oneOf, pick, requireFields, setClause, toId, like } from '../../utils/http.js';

const router = Router();
router.use(clinicScope(), requirePermission('supplier.manage'));

const FIELDS = ['name', 'contact_person', 'mobile', 'email', 'address', 'gstin', 'status',
  'state', 'pincode', 'phone', 'dl_no1', 'dl_no2'];
const TEXT = { state: 50, pincode: 10, phone: 20, dl_no1: 50, dl_no2: 50 };

function clean(body, isNew = false) {
  const data = pick(body, FIELDS);
  for (const [f, max] of Object.entries(TEXT)) {
    if (f in data) data[f] = data[f] == null || String(data[f]).trim() === '' ? null : String(data[f]).trim().slice(0, max);
  }
  if (data.pincode && !/^\d{6}$/.test(data.pincode)) throw badRequest('Pin code must be 6 digits', 'VALIDATION');
  // Address and Mobile No are required: a new vendor must have them, and an edit cannot clear them
  for (const [f, label] of [['address', 'Address'], ['mobile', 'Mobile No']]) {
    if (f in data) data[f] = String(data[f] ?? '').trim();
    if ((isNew || f in data) && !data[f]) throw badRequest(`${label} is required`, 'VALIDATION');
  }
  oneOf(data.status, ['active', 'inactive'], 'status');
  if (data.gstin) {
    data.gstin = data.gstin.toUpperCase();
    if (!/^[0-9A-Z]{15}$/.test(data.gstin)) throw badRequest('GSTIN must be 15 characters', 'VALIDATION');
  }
  return data;
}

router.get('/', async (req, res) => {
  const where = ['clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(name LIKE ? OR mobile LIKE ? OR contact_person LIKE ?)');
    params.push(like(req.query.q), like(req.query.q), like(req.query.q));
  }
  if (req.query.status) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  res.json({ rows: await query(`SELECT * FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name`, params) });
});

router.get('/:id', async (req, res) => {
  const [row] = await query('SELECT * FROM suppliers WHERE id = ? AND clinic_id = ?', [toId(req.params.id), req.clinicId]);
  if (!row) throw notFound('Supplier');
  res.json(row);
});

router.post('/', async (req, res) => {
  const data = clean(req.body, true);
  requireFields(data, ['name']);
  const newId = await insertRow(query, 'suppliers', { ...data, clinic_id: req.clinicId, created_by: req.user.id });
  const [row] = await query('SELECT * FROM suppliers WHERE id = ?', [newId]);
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(clean(req.body));
  const r = await query(`UPDATE suppliers SET ${sql}, updated_at = NOW() WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Supplier');
  const [row] = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
  res.json(row);
});

export default router;
