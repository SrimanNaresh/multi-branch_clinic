import { Router } from '../../lib/mini-express.js';
import { hashPassword } from '../../lib/security.js';
import { query, tx, insertRow, updateRow, pageSql, isDuplicateKey } from '../../config/db.js';
import { requirePermission } from '../../middleware/access.js';
import { GLOBAL_ROLES, ROLES, isGlobalRole } from '../../../../shared/permissions.js';
import { checkTimeSlots, SLOT_ERRORS } from '../../../../shared/timeSlots.js';
import { nextSequence, formatEmployeeCode, formatAdminCode, GLOBAL_SEQ_CLINIC } from '../../utils/codes.js';
import { badRequest, conflict, forbidden, notFound, oneOf, paging, pick, requireFields, toId, like } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';

const router = Router();

const FIELDS = [
  'name', 'gender', 'dob', 'mobile', 'email', 'designation', 'qualification', 'address', 'join_date',
  'role', 'unit_type', 'clinic_id', 'pharmacy_id', 'lab_id', 'username', 'can_login', 'status',
];

const PUBLIC_COLUMNS = `e.id, e.emp_code, e.name, e.gender, e.dob, e.mobile, e.email, e.designation, e.qualification,
  e.address, e.join_date, e.role, e.unit_type, e.clinic_id, e.pharmacy_id, e.lab_id, e.username, e.can_login,
  e.status, e.last_login_at, e.created_at,
  c.name AS clinic_name, c.code AS clinic_code, p.name AS pharmacy_name, l.name AS lab_name`;
const FROM = `FROM employees e
  LEFT JOIN clinics c ON c.id = e.clinic_id
  LEFT JOIN pharmacies p ON p.id = e.pharmacy_id
  LEFT JOIN labs l ON l.id = e.lab_id`;

const SLOTS_SQL = `SELECT CONVERT(char(5), start_time, 108) AS start_time, CONVERT(char(5), end_time, 108) AS end_time,
    slot_minutes, CONVERT(char(5), break_start, 108) AS break_start, CONVERT(char(5), break_end, 108) AS break_end
  FROM doctor_time_slots WHERE employee_id = ? ORDER BY start_time`;

async function getEmployee(id) {
  const [row] = await query(`SELECT ${PUBLIC_COLUMNS} ${FROM} WHERE e.id = ?`, [id]);
  if (row) {
    row.time_slots = row.role === 'doctor' ? await query(SLOTS_SQL, [id]) : [];
  }
  return row;
}

/** Validated doctor time slots from the request body, or undefined when the body has none. */
function readTimeSlots(body) {
  if (body.time_slots === undefined) return undefined;
  if (!Array.isArray(body.time_slots)) throw badRequest('time_slots must be a list', 'VALIDATION');
  const { slots, errors } = checkTimeSlots(body.time_slots);
  if (errors.length) {
    const { row, code } = errors[0];
    throw badRequest(`Time slot ${row + 1}: ${SLOT_ERRORS[code]}`, 'VALIDATION');
  }
  return slots;
}

/** Replaces the doctor's time slots (none for other roles). */
async function saveTimeSlots(q, employeeId, clinicId, role, slots) {
  await q('DELETE FROM doctor_time_slots WHERE employee_id = ?', [employeeId]);
  if (role !== 'doctor') return;
  for (const s of slots) await insertRow(q, 'doctor_time_slots', { ...s, employee_id: employeeId, clinic_id: clinicId });
}

/**
 * Validates the assignment (role ↔ clinic / pharmacy / lab) and normalises it:
 *  - Super Admin / Admin → main office, no clinic
 *  - pharmacy / lab staff → clinic taken from the linked unit
 */
async function resolveAssignment(data, actor) {
  oneOf(data.role, ROLES, 'role');
  oneOf(data.unit_type, ['main', 'clinic', 'pharmacy', 'lab'], 'unit_type');
  oneOf(data.gender, ['M', 'F', 'O'], 'gender');
  oneOf(data.status, ['active', 'inactive'], 'status');
  for (const f of ['dob', 'join_date']) if (data[f] && !isISODate(data[f])) throw badRequest(`Invalid ${f}`, 'VALIDATION');

  if (GLOBAL_ROLES.includes(data.role)) {
    if (actor.role !== 'super_admin') throw forbidden('Only Super Admin can create or change Admin users');
    return { ...data, unit_type: 'main', clinic_id: null, pharmacy_id: null, lab_id: null };
  }

  const unit = data.unit_type && data.unit_type !== 'main' ? data.unit_type : 'clinic';
  const out = { ...data, unit_type: unit, pharmacy_id: null, lab_id: null };

  if (unit === 'pharmacy') {
    const [ph] = await query('SELECT id, clinic_id FROM pharmacies WHERE id = ?', [toId(data.pharmacy_id, 'pharmacy')]);
    if (!ph) throw badRequest('Pharmacy does not exist', 'VALIDATION');
    out.pharmacy_id = ph.id;
    out.clinic_id = ph.clinic_id;
  } else if (unit === 'lab') {
    const [lab] = await query('SELECT id, clinic_id FROM labs WHERE id = ?', [toId(data.lab_id, 'lab')]);
    if (!lab) throw badRequest('Lab does not exist', 'VALIDATION');
    out.lab_id = lab.id;
    out.clinic_id = lab.clinic_id;
  } else {
    const [c] = await query('SELECT id FROM clinics WHERE id = ?', [toId(data.clinic_id, 'clinic')]);
    if (!c) throw badRequest('Clinic does not exist', 'VALIDATION');
    out.clinic_id = c.id;
  }
  return out;
}

function normaliseLogin(data, password, { isNew }) {
  if (data.can_login !== undefined) data.can_login = data.can_login ? 1 : 0;
  const canLogin = data.can_login ?? 1;
  if (canLogin) {
    if (isNew) requireFields({ ...data, password }, ['username', 'password']);
    if (data.username && !/^[a-zA-Z0-9._@-]{3,60}$/.test(data.username)) {
      throw badRequest('Username: 3–60 letters, digits or . _ @ -', 'VALIDATION');
    }
  }
  if (password !== undefined && password !== null && password !== '' && String(password).length < 6) {
    throw badRequest('Password must be at least 6 characters', 'VALIDATION');
  }
}

// GET /api/employees?clinic_id=&role=&q=&status=&page=
// Admins: all clinics (optionally filtered). Branch users: own clinic only.
router.get('/', requirePermission('employee.view'), async (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const where = [];
  const params = [];
  if (isGlobalRole(req.user.role)) {
    // ?clinic_id= (Main Clinic filter) wins over the clinic switcher header; 'main' = admin staff
    const cid = req.query.clinic_id ?? req.get('x-clinic-id');
    if (cid === 'main') where.push('e.clinic_id IS NULL');
    else if (cid && cid !== 'all') {
      where.push('e.clinic_id = ?');
      params.push(toId(cid, 'clinic'));
    }
  } else {
    where.push('e.clinic_id = ?');
    params.push(req.user.clinic_id);
  }
  if (req.query.role) {
    where.push('e.role = ?');
    params.push(req.query.role);
  }
  if (req.query.status) {
    where.push('e.status = ?');
    params.push(req.query.status);
  }
  if (req.query.q) {
    where.push('(e.name LIKE ? OR e.mobile LIKE ? OR e.emp_code LIKE ? OR e.username LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${FROM} ${whereSql}`, params);
  const rows = await query(`SELECT ${PUBLIC_COLUMNS} ${FROM} ${whereSql} ORDER BY e.name ${pageSql}`, [...params, offset, limit]);
  res.json({ rows, total, page, limit });
});

router.get('/:id', requirePermission('employee.view'), async (req, res) => {
  const row = await getEmployee(toId(req.params.id));
  if (!row || (!isGlobalRole(req.user.role) && row.clinic_id !== req.user.clinic_id)) throw notFound('Employee');
  res.json(row);
});

router.post('/', requirePermission('employee.create'), async (req, res) => {
  const body = req.body || {};
  let data = pick(body, FIELDS);
  requireFields(data, ['name', 'role']);
  normaliseLogin(data, body.password, { isNew: true });
  data = await resolveAssignment(data, req.user);
  const slots = readTimeSlots(body) || [];
  if (body.password) data.password_hash = await hashPassword(body.password);

  const id = await tx(async (q) => {
    let empCode;
    if (data.clinic_id) {
      const [c] = await q('SELECT code FROM clinics WHERE id = ?', [data.clinic_id]);
      empCode = formatEmployeeCode(c.code, await nextSequence(q, data.clinic_id, 'employee'));
    } else {
      empCode = formatAdminCode(await nextSequence(q, GLOBAL_SEQ_CLINIC, 'employee'));
    }
    const newId = await insertRow(q, 'employees', { ...data, emp_code: empCode, created_by: req.user.id });
    if (data.role === 'doctor' && slots.length) await saveTimeSlots(q, newId, data.clinic_id, data.role, slots);
    return newId;
  });
  res.status(201).json(await getEmployee(id));
});

router.put('/:id', requirePermission('employee.edit'), async (req, res) => {
  const id = toId(req.params.id);
  const [current] = await query('SELECT * FROM employees WHERE id = ?', [id]);
  if (!current) throw notFound('Employee');
  if (GLOBAL_ROLES.includes(current.role) && req.user.role !== 'super_admin') {
    throw forbidden('Only Super Admin can change Admin users');
  }

  const body = req.body || {};
  let data = pick(body, FIELDS);
  normaliseLogin(data, body.password, { isNew: false });
  if (id === req.user.id && ((data.status && data.status !== 'active') || (data.role && data.role !== current.role))) {
    throw badRequest('You cannot deactivate yourself or change your own role', 'VALIDATION');
  }

  // Re-validate assignment if any part of it changed
  if (['role', 'unit_type', 'clinic_id', 'pharmacy_id', 'lab_id'].some((k) => k in data)) {
    data = await resolveAssignment({
      role: current.role, unit_type: current.unit_type, clinic_id: current.clinic_id,
      pharmacy_id: current.pharmacy_id, lab_id: current.lab_id, ...data,
    }, req.user);
    // emp_code keeps the original clinic prefix as history if the employee moves clinic.
  }
  if (data.can_login && !current.username && !data.username) throw badRequest('Username is required for login', 'VALIDATION');
  if (data.can_login && !current.password_hash && !body.password) throw badRequest('Password is required for login', 'VALIDATION');
  if (body.password) data.password_hash = await hashPassword(body.password);
  const slots = readTimeSlots(body);
  const role = data.role ?? current.role;
  const clinicId = data.clinic_id !== undefined ? data.clinic_id : current.clinic_id;

  if (!Object.keys(data).length && slots === undefined) throw badRequest('Nothing to update', 'VALIDATION');
  try {
    await tx(async (q) => {
      if (Object.keys(data).length) await updateRow(q, 'employees', data, 'id = ?', [id]);
      // new list sent, or no longer a doctor, or moved clinic: rewrite the slots
      if (slots !== undefined || role !== 'doctor' || clinicId !== current.clinic_id) {
        const keep = slots ?? (await q(SLOTS_SQL, [id]));
        await saveTimeSlots(q, id, clinicId, role, keep);
      }
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict('Username already taken', 'DUPLICATE');
    throw e;
  }
  res.json(await getEmployee(id));
});

export default router;
