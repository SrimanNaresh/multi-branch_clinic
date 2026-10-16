import { Router } from '../lib/mini-express.js';
import { checkPassword, hashPassword } from '../lib/security.js';
import { query } from '../config/db.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { HttpError, badRequest, requireFields } from '../utils/http.js';

const router = Router();

// Simple in-memory brute-force guard: 10 failed attempts per username+IP per 15 min.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) return false;
  return f.count >= 10;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}

async function loadProfile(id) {
  const rows = await query(
    `SELECT e.id, e.emp_code, e.name, e.role, e.clinic_id, e.unit_type, e.pharmacy_id, e.lab_id,
            e.mobile, e.email, e.designation,
            c.name AS clinic_name, c.code AS clinic_code
       FROM employees e LEFT JOIN clinics c ON c.id = e.clinic_id
      WHERE e.id = ?`,
    [id],
  );
  return rows[0];
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  requireFields({ username, password }, ['username', 'password']);
  const key = `${String(username).toLowerCase()}|${req.ip}`;
  if (tooManyAttempts(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.', 'RATE_LIMITED');

  const rows = await query(
    `SELECT e.id, e.role, e.password_hash, e.status, e.can_login, e.clinic_id, c.status AS clinic_status
       FROM employees e LEFT JOIN clinics c ON c.id = e.clinic_id
      WHERE e.username = ?`,
    [String(username).trim()],
  );
  const emp = rows[0];
  const ok = emp?.password_hash && (await checkPassword(password, emp.password_hash));
  if (!ok) {
    recordFailure(key);
    throw new HttpError(401, 'Invalid username or password', 'BAD_CREDENTIALS');
  }
  if (emp.status !== 'active' || !emp.can_login) throw new HttpError(403, 'Your login is disabled', 'DISABLED');
  if (emp.clinic_id && emp.clinic_status !== 'active') throw new HttpError(403, 'Your clinic is inactive', 'CLINIC_INACTIVE');

  failures.delete(key);
  await query('UPDATE employees SET last_login_at = NOW() WHERE id = ?', [emp.id]);
  res.json({ token: signToken(emp), user: await loadProfile(emp.id) });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: await loadProfile(req.user.id) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  requireFields({ current_password, new_password }, ['current_password', 'new_password']);
  if (String(new_password).length < 6) throw badRequest('New password must be at least 6 characters', 'VALIDATION');
  const [row] = await query('SELECT password_hash FROM employees WHERE id = ?', [req.user.id]);
  if (!row?.password_hash || !(await checkPassword(current_password, row.password_hash))) {
    throw badRequest('Current password is wrong', 'BAD_CREDENTIALS');
  }
  await query('UPDATE employees SET password_hash = ? WHERE id = ?', [await hashPassword(new_password), req.user.id]);
  res.json({ ok: true });
});

export default router;
