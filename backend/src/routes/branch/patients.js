import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { nextSequence, formatPatientCode } from '../../utils/codes.js';
import { badRequest, conflict, notFound, oneOf, paging, pick, requireFields, setClause, toId, like } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope());   // every route below is scoped to req.clinicId

const FIELDS = ['name', 'gender', 'dob', 'age_years', 'mobile', 'alt_mobile', 'email', 'address', 'city',
  'blood_group', 'occupation', 'notes', 'status'];

function clean(body) {
  const data = pick(body, FIELDS);
  oneOf(data.gender, ['M', 'F', 'O'], 'gender');
  oneOf(data.status, ['active', 'inactive'], 'status');
  if (data.dob && !isISODate(data.dob)) throw badRequest('Invalid date of birth', 'VALIDATION');
  if (data.age_years !== undefined && data.age_years !== null) {
    const age = Number(data.age_years);
    if (!Number.isInteger(age) || age < 0 || age > 130) throw badRequest('Invalid age', 'VALIDATION');
    data.age_years = age;
  }
  if (data.mobile && !/^[0-9+\-\s]{6,20}$/.test(data.mobile)) throw badRequest('Invalid mobile number', 'VALIDATION');
  return data;
}

async function getPatient(clinicId, id) {
  const [row] = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS visit_count,
            (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS last_visit
       FROM patients p WHERE p.id = ? AND p.clinic_id = ?`,
    [id, clinicId],
  );
  return row;
}

// GET /api/patients?q=&page=&limit=&status=
router.get('/', requirePermission('patient.view'), async (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const where = ['p.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.q) {
    where.push('(p.name LIKE ? OR p.mobile LIKE ? OR p.patient_code LIKE ? OR p.alt_mobile LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  if (req.query.status) {
    where.push('p.status = ?');
    params.push(req.query.status);
  }
  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM patients p WHERE ${w}`, params);
  const rows = await query(
    `SELECT p.id, p.patient_code, p.name, p.gender, p.age_years, p.dob, p.mobile, p.city, p.status, p.created_at
       FROM patients p WHERE ${w} ORDER BY p.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit });
});

router.get('/:id', requirePermission('patient.view'), async (req, res) => {
  const row = await getPatient(req.clinicId, toId(req.params.id));
  if (!row) throw notFound('Patient');
  res.json(row);
});

// Only Admin / Super Admin (patient.create) can register patients.
// Body may include force: true to register despite a same name + mobile match.
router.post('/', requirePermission('patient.create'), async (req, res) => {
  const data = clean(req.body);
  requireFields(data, ['name', 'mobile']);

  if (!req.body.force) {
    const dupes = await query(
      'SELECT TOP 5 id, patient_code, name, mobile FROM patients WHERE clinic_id = ? AND mobile = ? AND name = ?',
      [req.clinicId, data.mobile, data.name],
    );
    if (dupes.length) {
      const err = conflict(`Patient already registered as ${dupes[0].patient_code}`, 'POSSIBLE_DUPLICATE');
      err.details = dupes;
      throw err;
    }
  }

  const id = await tx(async (q) => {
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const n = await nextSequence(q, req.clinicId, 'patient');
    return insertRow(q, 'patients', {
      ...data, clinic_id: req.clinicId, patient_code: formatPatientCode(clinic.code, n), created_by: req.user.id,
    });
  });
  res.status(201).json(await getPatient(req.clinicId, id));
});

router.put('/:id', requirePermission('patient.edit'), async (req, res) => {
  const id = toId(req.params.id);
  const { sql, params } = setClause(clean(req.body));
  const r = await query(`UPDATE patients SET ${sql}, updated_at = NOW() WHERE id = ? AND clinic_id = ?`, [...params, id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Patient');
  res.json(await getPatient(req.clinicId, id));
});

export default router;
