import { query } from '../config/db.js';
import { can, isGlobalRole } from '../../../shared/permissions.js';
import { HttpError, forbidden } from '../utils/http.js';

/** Allow the request if the user's role has ANY of the given permissions. */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (permissions.some((p) => can(req.user.role, p))) return next();
    throw forbidden();
  };
}

/** Super Admin / Admin only. */
export function requireGlobalRole(req, _res, next) {
  if (isGlobalRole(req.user.role)) return next();
  throw forbidden('Only Admin / Super Admin can do this');
}

/**
 * Resolves req.clinicId — the clinic every query in the request is scoped to.
 *
 *  - Branch users: ALWAYS their own clinic. Any X-Clinic-Id header is ignored,
 *    so they can never read or write another clinic's data.
 *  - Super Admin / Admin: the clinic chosen in the clinic switcher, sent as the
 *    X-Clinic-Id header (or ?clinic_id=). With { optional: true } a missing value
 *    or "all" means "all clinics" (req.clinicId = null).
 */
export function clinicScope({ optional = false } = {}) {
  return async (req, _res, next) => {
    const user = req.user;
    if (!isGlobalRole(user.role)) {
      req.clinicId = user.clinic_id;
      return next();
    }

    const raw = req.get('x-clinic-id') ?? req.query.clinic_id;
    if (raw === undefined || raw === null || raw === '' || raw === 'all') {
      if (optional) {
        req.clinicId = null;
        return next();
      }
      throw new HttpError(400, 'Select a clinic first', 'CLINIC_REQUIRED');
    }

    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid clinic', 'VALIDATION');
    const rows = await query('SELECT id FROM clinics WHERE id = ?', [id]);
    if (!rows.length) throw new HttpError(404, 'Clinic not found', 'NOT_FOUND');
    req.clinicId = id;
    next();
  };
}
