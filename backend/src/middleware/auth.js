import { signJwt, verifyJwt } from '../lib/security.js';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { HttpError } from '../utils/http.js';
import { effectivePermissions } from '../../../shared/permissions.js';

export function signToken(employee) {
  return signJwt({ sub: employee.id, role: employee.role }, env.jwtSecret, env.jwtExpiresIn);
}

/**
 * Verifies the Bearer token and loads the employee fresh from the DB on every
 * request, so deactivating a user (or their clinic) takes effect immediately.
 */
export async function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in', 'UNAUTHENTICATED');

  let payload;
  try {
    payload = verifyJwt(token, env.jwtSecret);
  } catch {
    throw new HttpError(401, 'Session expired, please log in again', 'UNAUTHENTICATED');
  }

  const rows = await query(
    `SELECT e.id, e.emp_code, e.name, e.role, e.clinic_id, e.unit_type, e.pharmacy_id, e.lab_id,
            e.status, e.can_login, c.status AS clinic_status
       FROM employees e LEFT JOIN clinics c ON c.id = e.clinic_id
      WHERE e.id = ?`,
    [payload.sub],
  );
  const user = rows[0];
  if (!user || user.status !== 'active' || !user.can_login || (user.clinic_id && user.clinic_status !== 'active')) {
    throw new HttpError(401, 'Account is not active', 'UNAUTHENTICATED');
  }
  user.permissions = await loadPermissions(user);
  req.user = user;
  next();
}

/** Role defaults plus this employee's Menu Permission changes. */
export async function loadPermissions({ id, role }) {
  const overrides = role === 'super_admin' ? [] : await query('SELECT permission, granted FROM employee_permissions WHERE employee_id = ?', [id]);
  return effectivePermissions(role, overrides);
}
