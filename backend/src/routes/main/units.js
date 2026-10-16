// Pharmacy Generation and Lab Generation share one implementation.
import { Router } from '../../lib/mini-express.js';
import { query, insertRow } from '../../config/db.js';
import { requirePermission } from '../../middleware/access.js';
import { isGlobalRole } from '../../../../shared/permissions.js';
import { badRequest, notFound, oneOf, pick, requireFields, setClause, toId, like } from '../../utils/http.js';

function unitRouter({ table, permission, label, extraFields = [] }) {
  const router = Router();
  const FIELDS = ['clinic_id', 'name', 'code', 'address', 'phone', 'status', ...extraFields];

  async function clean(body) {
    const data = pick(body, FIELDS);
    if (data.code !== undefined && data.code !== null) {
      data.code = String(data.code).toUpperCase();
      if (!/^[A-Z0-9-]{2,10}$/.test(data.code)) throw badRequest('Code must be 2–10 letters/digits', 'VALIDATION');
    }
    if (data.clinic_id !== undefined) {
      data.clinic_id = toId(data.clinic_id, 'clinic');
      const [c] = await query('SELECT id FROM clinics WHERE id = ?', [data.clinic_id]);
      if (!c) throw badRequest('Linked clinic does not exist', 'VALIDATION');
    }
    oneOf(data.status, ['active', 'inactive'], 'status');
    return data;
  }

  const selectSql = `SELECT u.*, c.name AS clinic_name, c.code AS clinic_code
                       FROM ${table} u JOIN clinics c ON c.id = u.clinic_id`;

  router.get('/', async (req, res) => {
    const where = [];
    const params = [];
    // Branch users only ever see units of their own clinic
    const clinicFilter = isGlobalRole(req.user.role) ? req.query.clinic_id : req.user.clinic_id;
    if (clinicFilter) {
      where.push('u.clinic_id = ?');
      params.push(toId(clinicFilter, 'clinic'));
    }
    if (req.query.status) {
      where.push('u.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR u.code LIKE ?)');
      params.push(like(req.query.q), like(req.query.q));
    }
    const rows = await query(`${selectSql} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name, u.name`, params);
    res.json({ rows });
  });

  router.get('/:id', async (req, res) => {
    const [row] = await query(`${selectSql} WHERE u.id = ?`, [toId(req.params.id)]);
    if (!row || (!isGlobalRole(req.user.role) && row.clinic_id !== req.user.clinic_id)) throw notFound(label);
    res.json(row);
  });

  router.post('/', requirePermission(permission), async (req, res) => {
    const data = await clean(req.body);
    requireFields(data, ['clinic_id', 'name', 'code']);
    const newId = await insertRow(query, table, { ...data, created_by: req.user.id });
    const [row] = await query(`${selectSql} WHERE u.id = ?`, [newId]);
    res.status(201).json(row);
  });

  router.put('/:id', requirePermission(permission), async (req, res) => {
    const id = toId(req.params.id);
    const [current] = await query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    if (!current) throw notFound(label);
    const { sql, params } = setClause(await clean(req.body));
    await query(`UPDATE ${table} SET ${sql}, updated_at = NOW() WHERE id = ?`, [...params, id]);
    const [row] = await query(`${selectSql} WHERE u.id = ?`, [id]);
    res.json(row);
  });

  return router;
}

export const pharmacyRoutes = unitRouter({ table: 'pharmacies', permission: 'pharmacy.manage', label: 'Pharmacy', extraFields: ['license_no'] });
export const labRoutes = unitRouter({ table: 'labs', permission: 'lab.manage', label: 'Lab' });
