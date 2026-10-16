import { Router } from '../../lib/mini-express.js';
import { query } from '../../config/db.js';
import { requirePermission } from '../../middleware/access.js';
import { isGlobalRole } from '../../../../shared/permissions.js';
import { badRequest, conflict, notFound, oneOf, pick, requireFields, setClause, toAmount, toId, like } from '../../utils/http.js';

const router = Router();
const FIELDS = ['name', 'code', 'address', 'city', 'phone', 'email', 'consultation_fee', 'status'];

function clean(body) {
  const data = pick(body, FIELDS);
  if (data.code !== undefined && data.code !== null) {
    data.code = String(data.code).toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(data.code)) throw badRequest('Code must be 2–10 letters/digits, e.g. CLA', 'VALIDATION');
  }
  if (data.consultation_fee !== undefined) data.consultation_fee = toAmount(data.consultation_fee, 'consultation_fee');
  oneOf(data.status, ['active', 'inactive'], 'status');
  return data;
}

// List: admins see every clinic (used by the clinic switcher); branch users only their own.
router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  if (!isGlobalRole(req.user.role)) {
    where.push('c.id = ?');
    params.push(req.user.clinic_id);
  }
  if (req.query.status) {
    where.push('c.status = ?');
    params.push(req.query.status);
  }
  if (req.query.q) {
    where.push('(c.name LIKE ? OR c.code LIKE ? OR c.city LIKE ?)');
    params.push(like(req.query.q), like(req.query.q), like(req.query.q));
  }
  const rows = await query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM pharmacies p WHERE p.clinic_id = c.id) AS pharmacy_count,
            (SELECT COUNT(*) FROM labs l WHERE l.clinic_id = c.id) AS lab_count,
            (SELECT COUNT(*) FROM employees e WHERE e.clinic_id = c.id AND e.status = 'active') AS employee_count
       FROM clinics c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.name`,
    params,
  );
  res.json({ rows });
});

router.get('/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!isGlobalRole(req.user.role) && id !== req.user.clinic_id) throw notFound('Clinic');
  const [row] = await query('SELECT * FROM clinics WHERE id = ?', [id]);
  if (!row) throw notFound('Clinic');
  res.json(row);
});

router.post('/', requirePermission('clinic.manage'), async (req, res) => {
  const data = clean(req.body);
  requireFields(data, ['name', 'code']);
  const result = await query('INSERT INTO clinics SET ?', [{ ...data, created_by: req.user.id }]);
  const [row] = await query('SELECT * FROM clinics WHERE id = ?', [result.insertId]);
  res.status(201).json(row);
});

router.put('/:id', requirePermission('clinic.manage'), async (req, res) => {
  const id = toId(req.params.id);
  const [current] = await query('SELECT * FROM clinics WHERE id = ?', [id]);
  if (!current) throw notFound('Clinic');
  const data = clean(req.body);

  // The code is printed into every patient ID and bill number – lock it once used.
  if (data.code && data.code !== current.code) {
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM patients WHERE clinic_id = ?', [id]);
    if (n > 0) throw conflict('Clinic code cannot change after patients are registered', 'CODE_LOCKED');
  }
  const { sql, params } = setClause(data);
  await query(`UPDATE clinics SET ${sql} WHERE id = ?`, [...params, id]);
  const [row] = await query('SELECT * FROM clinics WHERE id = ?', [id]);
  res.json(row);
});

export default router;
