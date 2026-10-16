// Patient & Queue: Confirm & Search → Confirm List
import { Router } from '../../lib/mini-express.js';
import { query, tx } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { nextSequence, tokenKey } from '../../utils/codes.js';
import { badRequest, conflict, notFound, oneOf, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope());

const QUEUE_SELECT = `
  SELECT q.id, q.queue_date, q.token_no, q.visit_type, q.status, q.confirmed_at, q.called_at, q.completed_at,
         q.patient_id, p.patient_code, p.name AS patient_name, p.mobile, p.gender, p.age_years,
         q.doctor_id, d.name AS doctor_name, v.id AS visit_id, v.status AS visit_status
    FROM queue_entries q
    JOIN patients p ON p.id = q.patient_id
    LEFT JOIN employees d ON d.id = q.doctor_id
    LEFT JOIN visits v ON v.queue_id = q.id`;

// Allowed status moves
const TRANSITIONS = {
  waiting: ['with_doctor', 'cancelled'],
  with_doctor: ['done', 'waiting'],
  done: [],
  cancelled: ['waiting'],
};

// GET /api/queue/search?q=  – find patients and show whether they are already in today's queue
router.get('/search', requirePermission('queue.confirm'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ rows: [] });
  const today = todayISO();
  const rows = await query(
    `SELECT p.id, p.patient_code, p.name, p.mobile, p.gender, p.age_years, p.city,
            (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS last_visit,
            qe.id AS queue_id, qe.token_no, qe.status AS queue_status
       FROM patients p
       LEFT JOIN queue_entries qe
              ON qe.patient_id = p.id AND qe.clinic_id = p.clinic_id AND qe.queue_date = ? AND qe.status <> 'cancelled'
      WHERE p.clinic_id = ? AND p.status = 'active'
        AND (p.name LIKE ? OR p.mobile LIKE ? OR p.patient_code LIKE ?)
      ORDER BY p.name LIMIT 25`,
    [today, req.clinicId, like(q), like(q), like(q)],
  );
  res.json({ rows });
});

// GET /api/queue/doctors – active doctors of this clinic (for assigning)
router.get('/doctors', requirePermission('queue.view', 'queue.confirm'), async (req, res) => {
  const rows = await query(
    "SELECT id, name, designation FROM employees WHERE clinic_id = ? AND role = 'doctor' AND status = 'active' ORDER BY name",
    [req.clinicId],
  );
  res.json({ rows });
});

// GET /api/queue?date=&status=  – Confirm List
router.get('/', requirePermission('queue.view'), async (req, res) => {
  const date = isISODate(req.query.date) ? req.query.date : todayISO();
  const where = ['q.clinic_id = ?', 'q.queue_date = ?'];
  const params = [req.clinicId, date];
  if (req.query.status) {
    where.push('q.status = ?');
    params.push(req.query.status);
  }
  if (req.query.doctor_id) {
    where.push('q.doctor_id = ?');
    params.push(toId(req.query.doctor_id, 'doctor'));
  }
  const rows = await query(`${QUEUE_SELECT} WHERE ${where.join(' AND ')} ORDER BY q.token_no`, params);
  const counts = { waiting: 0, with_doctor: 0, done: 0, cancelled: 0 };
  for (const r of rows) counts[r.status] += 1;
  res.json({ date, rows, counts });
});

// POST /api/queue  { patient_id, visit_type?, doctor_id? }  – confirm into today's queue
router.post('/', requirePermission('queue.confirm'), async (req, res) => {
  const patientId = toId(req.body?.patient_id, 'patient');
  const visitType = req.body?.visit_type || 'new';
  oneOf(visitType, ['new', 'follow_up'], 'visit_type');
  const doctorId = req.body?.doctor_id ? toId(req.body.doctor_id, 'doctor') : null;
  const today = todayISO();

  const id = await tx(async (q) => {
    const [patient] = await q("SELECT id FROM patients WHERE id = ? AND clinic_id = ? AND status = 'active' FOR UPDATE", [patientId, req.clinicId]);
    if (!patient) throw notFound('Patient');
    if (doctorId) {
      const [doc] = await q("SELECT id FROM employees WHERE id = ? AND clinic_id = ? AND role = 'doctor' AND status = 'active'", [doctorId, req.clinicId]);
      if (!doc) throw badRequest('Doctor not found in this clinic', 'VALIDATION');
    }
    const [existing] = await q(
      "SELECT token_no FROM queue_entries WHERE clinic_id = ? AND patient_id = ? AND queue_date = ? AND status IN ('waiting','with_doctor')",
      [req.clinicId, patientId, today],
    );
    if (existing) throw conflict(`Already in today's queue (token ${existing.token_no})`, 'ALREADY_IN_QUEUE');

    const token = await nextSequence(q, req.clinicId, tokenKey(today));
    const r = await q('INSERT INTO queue_entries SET ?', [{
      clinic_id: req.clinicId, patient_id: patientId, queue_date: today, token_no: token,
      visit_type: visitType, doctor_id: doctorId, confirmed_by: req.user.id,
    }]);
    return r.insertId;
  });
  const [row] = await query(`${QUEUE_SELECT} WHERE q.id = ?`, [id]);
  res.status(201).json(row);
});

// PATCH /api/queue/:id/status  { status }
router.patch('/:id/status', requirePermission('queue.update'), async (req, res) => {
  const id = toId(req.params.id);
  const status = req.body?.status;
  oneOf(status, Object.keys(TRANSITIONS), 'status');
  const [current] = await query('SELECT status FROM queue_entries WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!current) throw notFound('Queue entry');
  if (!TRANSITIONS[current.status].includes(status)) {
    throw badRequest(`Cannot move from ${current.status} to ${status}`, 'BAD_TRANSITION');
  }
  const extra = status === 'with_doctor' ? ', called_at = NOW()' : status === 'done' ? ', completed_at = NOW()' : '';
  await query(`UPDATE queue_entries SET status = ?${extra} WHERE id = ? AND clinic_id = ?`, [status, id, req.clinicId]);
  const [row] = await query(`${QUEUE_SELECT} WHERE q.id = ?`, [id]);
  res.json(row);
});

export default router;
