// Main Clinic → Menu Permission: user-wise access on top of the role defaults.
// Only the differences from the role are stored (employee_permissions).
import { Router } from '../../lib/mini-express.js';
import { query, tx } from '../../config/db.js';
import { requirePermission } from '../../middleware/access.js';
import {
  ALL_PERMISSIONS, effectivePermissions, grantablePermissions, overridesFor, rolePermissions,
} from '../../../../shared/permissions.js';
import { badRequest, forbidden, notFound, toId } from '../../utils/http.js';

const router = Router();
router.use(requirePermission('permission.manage'));

async function loadTarget(id) {
  const [emp] = await query(
    `SELECT e.id, e.emp_code, e.name, e.role, e.clinic_id, e.status, c.name AS clinic_name, c.code AS clinic_code
       FROM employees e LEFT JOIN clinics c ON c.id = e.clinic_id WHERE e.id = ?`,
    [id],
  );
  if (!emp) throw notFound('Employee');
  return emp;
}

/** Who may change whose access: never your own, never Super Admin, Admins only by Super Admin. */
function checkEditable(actor, emp) {
  if (emp.id === actor.id) return 'You cannot change your own access';
  if (emp.role === 'super_admin') return 'Super Admin always has full access';
  if (emp.role === 'admin' && actor.role !== 'super_admin') return 'Only Super Admin can change an Admin’s access';
  return null;
}

async function describe(emp, actor) {
  const overrides = await query(
    `SELECT ep.permission, ep.granted, ep.updated_at, u.name AS updated_by_name
       FROM employee_permissions ep LEFT JOIN employees u ON u.id = ep.updated_by
      WHERE ep.employee_id = ? ORDER BY ep.permission`,
    [emp.id],
  );
  return {
    employee: emp,
    role_permissions: rolePermissions(emp.role),
    grantable: grantablePermissions(emp.role),
    overrides,
    permissions: effectivePermissions(emp.role, overrides),
    locked: checkEditable(actor, emp),
  };
}

// GET /api/permissions/:employeeId – role defaults, changes and the resulting access
router.get('/:employeeId', async (req, res) => {
  const emp = await loadTarget(toId(req.params.employeeId, 'employee'));
  res.json(await describe(emp, req.user));
});

// PUT /api/permissions/:employeeId { permissions: [...] } – the full list the employee should have
router.put('/:employeeId', async (req, res) => {
  const emp = await loadTarget(toId(req.params.employeeId, 'employee'));
  const locked = checkEditable(req.user, emp);
  if (locked) throw forbidden(locked);

  const wanted = req.body?.permissions;
  if (!Array.isArray(wanted)) throw badRequest('permissions must be a list', 'VALIDATION');
  const unknown = wanted.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length) throw badRequest(`Unknown permission: ${unknown.join(', ')}`, 'VALIDATION');
  const grantable = new Set(grantablePermissions(emp.role));
  const notAllowed = wanted.filter((p) => !grantable.has(p));
  if (notAllowed.length) {
    throw badRequest(`Branch staff cannot be given main-office access: ${notAllowed.join(', ')}`, 'VALIDATION');
  }

  const overrides = overridesFor(emp.role, wanted);
  await tx(async (q) => {
    await q('DELETE FROM employee_permissions WHERE employee_id = ?', [emp.id]);
    for (const o of overrides) {
      await q('INSERT INTO employee_permissions (employee_id, permission, granted, updated_by) VALUES (?, ?, ?, ?)',
        [emp.id, o.permission, o.granted ? 1 : 0, req.user.id]);
    }
  });
  res.json(await describe(emp, req.user));
});

export default router;
