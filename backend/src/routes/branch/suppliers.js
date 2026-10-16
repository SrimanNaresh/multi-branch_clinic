import { Router } from 'express';
import { query } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, oneOf, pick, requireFields, setClause, toId, like } from '../../utils/http.js';

const router = Router();
router.use(clinicScope(), requirePermission('supplier.manage'));

const FIELDS = ['name', 'contact_person', 'mobile', 'email', 'address', 'gstin', 'status'];

function clean(body) {
  const data = pick(body, FIELDS);
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
  const data = clean(req.body);
  requireFields(data, ['name']);
  const r = await query('INSERT INTO suppliers SET ?', [{ ...data, clinic_id: req.clinicId, created_by: req.user.id }]);
  const [row] = await query('SELECT * FROM suppliers WHERE id = ?', [r.insertId]);
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(clean(req.body));
  const r = await query(`UPDATE suppliers SET ${sql} WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Supplier');
  const [row] = await query('SELECT * FROM suppliers WHERE id = ?', [id]);
  res.json(row);
});

export default router;
