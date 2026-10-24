// Patient & Queue: Confirm & Search → Confirm List
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, isDuplicateKey } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { nextSequence, tokenKey } from '../../utils/codes.js';
import { HttpError, badRequest, conflict, notFound, oneOf, toId, like } from '../../utils/http.js';
import { isISODate, nowMinutes, todayISO } from '../../utils/dates.js';
import { checkVitals, VITAL_ERRORS, VITAL_FIELDS } from '../../../../shared/vitals.js';
import { expandTokens, toMinutes } from '../../../../shared/timeSlots.js';
import { ATTACHMENT_ERRORS, MAX_ATTACHMENT_BYTES, checkAttachment, fileSize, sniffMime } from '../../../../shared/attachments.js';

const SLOT_PASSED = 'This token’s time has passed – it is read-only and cannot be booked or changed';
// A token is read-only once its end time has passed (today, clinic time zone).
const tokenPassed = (token) => toMinutes(token.end) <= nowMinutes();

const router = Router();
router.use(clinicScope());

const QUEUE_SELECT = `
  SELECT q.id, q.queue_date, q.token_no, q.visit_type, q.status, q.confirmed_at, q.called_at, q.completed_at,
         CONVERT(char(5), q.slot_time, 108) AS slot_time, q.arrived_at,
         q.patient_id, p.patient_code, p.name AS patient_name, p.mobile, p.gender, p.age_years,
         q.doctor_id, d.name AS doctor_name, v.id AS visit_id, v.status AS visit_status,
         pv.id AS vitals_id, pv.height_cm, pv.weight_kg, pv.bp_systolic, pv.bp_diastolic, pv.pulse_bpm,
         pv.temperature_f, pv.comments AS vitals_comments
    FROM queue_entries q
    JOIN patients p ON p.id = q.patient_id
    LEFT JOIN employees d ON d.id = q.doctor_id
    LEFT JOIN visits v ON v.queue_id = q.id
    LEFT JOIN patient_vitals pv ON pv.queue_id = q.id`;

const VITALS_SELECT = `
  SELECT pv.id, pv.queue_id, pv.patient_id, ${VITAL_FIELDS.map((f) => `pv.${f}`).join(', ')},
         pv.recorded_at, pv.updated_at, r.name AS recorded_by_name, u.name AS updated_by_name
    FROM patient_vitals pv
    LEFT JOIN employees r ON r.id = pv.recorded_by
    LEFT JOIN employees u ON u.id = pv.updated_by`;

// Allowed status moves
const TRANSITIONS = {
  waiting: ['with_doctor', 'cancelled'],
  with_doctor: ['done', 'waiting'],
  done: [],
  cancelled: ['waiting'],
};

/** A doctor's time-slot rows (doctor_time_slots) as 'HH:MM' strings. */
async function doctorSlotRows(q, doctorId) {
  return q(
    `SELECT CONVERT(char(5), start_time, 108) AS start_time, CONVERT(char(5), end_time, 108) AS end_time, slot_minutes,
            CONVERT(char(5), break_start, 108) AS break_start, CONVERT(char(5), break_end, 108) AS break_end
       FROM doctor_time_slots WHERE employee_id = ? ORDER BY start_time`,
    [doctorId],
  );
}

/**
 * Checks that slotTime is one of the doctor's tokens and still free today (inside a transaction).
 * Returns the token ({ no, start, end }).
 */
async function claimSlot(q, clinicId, doctorId, slotTime, today, exceptQueueId = 0) {
  const token = expandTokens(await doctorSlotRows(q, doctorId)).find((t) => t.start === slotTime);
  if (!token) throw badRequest('This time is not one of the doctor’s time slots', 'VALIDATION');
  if (tokenPassed(token)) throw badRequest(SLOT_PASSED, 'SLOT_PASSED');
  const [taken] = await q(
    `SELECT TOP 1 q.token_no, p.name FROM queue_entries q WITH (UPDLOCK, HOLDLOCK) JOIN patients p ON p.id = q.patient_id
      WHERE q.clinic_id = ? AND q.queue_date = ? AND q.doctor_id = ? AND q.slot_time = ? AND q.status <> 'cancelled' AND q.id <> ?`,
    [clinicId, today, doctorId, slotTime, exceptQueueId],
  );
  if (taken) throw conflict(`${slotTime} is already booked for ${taken.name} (token ${taken.token_no})`, 'SLOT_TAKEN');
  return token;
}

const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/queue/tokens?doctor_id=  – today's tokens per doctor (from their time slots) with who is booked
router.get('/tokens', requirePermission('queue.view'), async (req, res) => {
  const today = todayISO();
  const params = [req.clinicId];
  let where = "clinic_id = ? AND role = 'doctor' AND status = 'active'";
  if (req.query.doctor_id) { where += ' AND id = ?'; params.push(toId(req.query.doctor_id, 'doctor')); }
  const doctors = await query(`SELECT id, name, designation FROM employees WHERE ${where} ORDER BY name`, params);
  const entries = await query(`${QUEUE_SELECT} WHERE q.clinic_id = ? AND q.queue_date = ? AND q.status <> 'cancelled' AND q.doctor_id IS NOT NULL ORDER BY q.token_no`,
    [req.clinicId, today]);

  const out = [];
  for (const d of doctors) {
    const sessions = await doctorSlotRows(query, d.id);
    const mine = entries.filter((e) => e.doctor_id === d.id);
    const tokens = expandTokens(sessions).map((t) => ({ ...t, entry: mine.find((e) => e.slot_time === t.start) || null }));
    const unslotted = mine.filter((e) => !e.slot_time || !tokens.some((t) => t.start === e.slot_time));
    out.push({ ...d, sessions, tokens, unslotted });
  }
  res.json({ date: today, doctors: out });
});

// GET /api/queue/search?q=  – find patients and show whether they are already in today's queue
router.get('/search', requirePermission('queue.confirm'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ rows: [] });
  const today = todayISO();
  const rows = await query(
    `SELECT TOP 25 p.id, p.patient_code, p.name, p.mobile, p.gender, p.age_years, p.city,
            (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id AND v.clinic_id = p.clinic_id) AS last_visit,
            qe.id AS queue_id, qe.token_no, qe.status AS queue_status
       FROM patients p
       OUTER APPLY (SELECT TOP 1 x.id, x.token_no, x.status FROM queue_entries x
                     WHERE x.patient_id = p.id AND x.clinic_id = p.clinic_id AND x.queue_date = ? AND x.status <> 'cancelled'
                     ORDER BY x.id DESC) qe
      WHERE p.clinic_id = ? AND p.status = 'active'
        AND (p.name LIKE ? OR p.mobile LIKE ? OR p.patient_code LIKE ?)
      ORDER BY p.name`,
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
  if (!req.body?.doctor_id) throw badRequest('Select the doctor before confirming', 'DOCTOR_REQUIRED');
  const doctorId = toId(req.body.doctor_id, 'doctor');
  const slotTime = req.body?.slot_time || null;
  if (slotTime && !SLOT_TIME.test(slotTime)) throw badRequest('Invalid slot time', 'VALIDATION');
  if (slotTime && !doctorId) throw badRequest('Choose the doctor for this time slot', 'VALIDATION');
  const today = todayISO();

  const id = await tx(async (q) => {
    const [patient] = await q("SELECT id FROM patients WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ? AND status = 'active'", [patientId, req.clinicId]);
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

    if (slotTime) await claimSlot(q, req.clinicId, doctorId, slotTime, today);

    const token = await nextSequence(q, req.clinicId, tokenKey(today));
    const newId = await insertRow(q, 'queue_entries', {
      clinic_id: req.clinicId, patient_id: patientId, queue_date: today, token_no: token,
      visit_type: visitType, doctor_id: doctorId, slot_time: slotTime, confirmed_by: req.user.id,
    });
    // a walk-in is at the clinic now; a Tokens booking arrives later (Token confirm in Confirm List)
    if (!slotTime) await q('UPDATE queue_entries SET arrived_at = NOW(), arrived_by = ? WHERE id = ?', [req.user.id, newId]);
    return newId;
  }).catch((e) => { throw isDuplicateKey(e) ? conflict('This time slot was just booked by someone else', 'SLOT_TAKEN') : e; });
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
  // vital signs saved = Token confirmed: the token can no longer be cancelled
  if (status === 'cancelled') {
    const [vitals] = await query('SELECT TOP 1 id FROM patient_vitals WHERE queue_id = ?', [id]);
    if (vitals) throw conflict('This token is confirmed (vital signs are saved) and cannot be cancelled', 'TOKEN_CONFIRMED');
  }
  // Send to doctor needs the token confirmed and vital signs saved
  if (current.status === 'waiting' && status === 'with_doctor') {
    const [vitals] = await query('SELECT TOP 1 id FROM patient_vitals WHERE queue_id = ?', [id]);
    if (!vitals) throw badRequest('Confirm the token and save vital signs before sending to the doctor', 'VITALS_REQUIRED');
  }
  const extra = status === 'with_doctor' ? ', called_at = NOW()' : status === 'done' ? ', completed_at = NOW()' : '';
  try {
    await query(`UPDATE queue_entries SET status = ?${extra} WHERE id = ? AND clinic_id = ?`, [status, id, req.clinicId]);
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict('Its time slot has been booked by another patient – free or change the slot first', 'SLOT_TAKEN');
    throw e;
  }
  const [row] = await query(`${QUEUE_SELECT} WHERE q.id = ?`, [id]);
  res.json(row);
});

// PATCH /api/queue/:id/arrive – Token confirm: a patient booked from Tokens has arrived at the clinic
router.patch('/:id/arrive', requirePermission('queue.confirm'), async (req, res) => {
  const id = toId(req.params.id);
  const [entry] = await query('SELECT id, status, queue_date, arrived_at FROM queue_entries WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!entry) throw notFound('Queue entry');
  if (entry.queue_date !== todayISO()) throw badRequest('Only today’s tokens can be confirmed', 'VALIDATION');
  if (entry.status === 'cancelled') throw conflict('This queue entry is cancelled', 'CANCELLED');
  if (!entry.arrived_at) {
    await query('UPDATE queue_entries SET arrived_at = NOW(), arrived_by = ? WHERE id = ? AND arrived_at IS NULL', [req.user.id, id]);
  }
  const [row] = await query(`${QUEUE_SELECT} WHERE q.id = ?`, [id]);
  res.json(row);
});

// PATCH /api/queue/:id/slot { doctor_id, slot_time }  – give a waiting patient a time slot, move it, or free it (slot_time null)
router.patch('/:id/slot', requirePermission('queue.confirm'), async (req, res) => {
  const id = toId(req.params.id);
  const slotTime = req.body?.slot_time || null;
  if (slotTime && !SLOT_TIME.test(slotTime)) throw badRequest('Invalid slot time', 'VALIDATION');
  await tx(async (q) => {
    const [entry] = await q(
      'SELECT id, status, queue_date, doctor_id, CONVERT(char(5), slot_time, 108) AS slot_time FROM queue_entries WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?',
      [id, req.clinicId],
    );
    if (!entry) throw notFound('Queue entry');
    if (entry.queue_date !== todayISO()) throw badRequest('Only today’s tokens can be changed', 'VALIDATION');
    if (entry.status !== 'waiting') throw conflict('Only a waiting patient can change time slot', 'BAD_STATUS');
    if (entry.slot_time && entry.doctor_id) {
      const current = expandTokens(await doctorSlotRows(q, entry.doctor_id)).find((t) => t.start === entry.slot_time);
      if (current && tokenPassed(current)) throw badRequest(SLOT_PASSED, 'SLOT_PASSED');
    }
    if (!slotTime) {
      await q('UPDATE queue_entries SET slot_time = NULL WHERE id = ?', [id]);
      return;
    }
    const doctorId = req.body?.doctor_id ? toId(req.body.doctor_id, 'doctor') : entry.doctor_id;
    if (!doctorId) throw badRequest('Choose the doctor for this time slot', 'VALIDATION');
    const [doc] = await q("SELECT id FROM employees WHERE id = ? AND clinic_id = ? AND role = 'doctor' AND status = 'active'", [doctorId, req.clinicId]);
    if (!doc) throw badRequest('Doctor not found in this clinic', 'VALIDATION');
    await claimSlot(q, req.clinicId, doctorId, slotTime, entry.queue_date, id);
    await q('UPDATE queue_entries SET doctor_id = ?, slot_time = ? WHERE id = ?', [doctorId, slotTime, id]);
  }).catch((e) => { throw isDuplicateKey(e) ? conflict('This time slot was just booked by someone else', 'SLOT_TAKEN') : e; });
  const [row] = await query(`${QUEUE_SELECT} WHERE q.id = ?`, [id]);
  res.json(row);
});

// GET /api/queue/:id/vitals – vital signs of one queue entry ({ vitals: null } when none yet)
router.get('/:id/vitals', requirePermission('queue.view', 'vitals.record'), async (req, res) => {
  const id = toId(req.params.id);
  const [entry] = await query('SELECT id FROM queue_entries WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!entry) throw notFound('Queue entry');
  const [vitals] = await query(`${VITALS_SELECT} WHERE pv.queue_id = ?`, [id]);
  res.json({ vitals: vitals || null });
});

// PUT /api/queue/:id/vitals { height_cm, weight_kg, bp_systolic, bp_diastolic, pulse_bpm, temperature_f, comments }
// Records the vital signs the first time, edits them afterwards. The status is not changed here –
// the patient moves to Examine only through Send to doctor.
router.put('/:id/vitals', requirePermission('vitals.record'), async (req, res) => {
  const id = toId(req.params.id);
  const { data, errors } = checkVitals(req.body || {});
  const [field, code] = Object.entries(errors)[0] || [];
  if (field) throw badRequest(field === '_form' ? 'Enter at least one vital sign' : `${field}: ${VITAL_ERRORS[code]}`, 'VALIDATION');

  await tx(async (q) => {
    const [entry] = await q('SELECT id, patient_id, status, arrived_at FROM queue_entries WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!entry) throw notFound('Queue entry');
    if (entry.status === 'cancelled') throw conflict('This queue entry is cancelled', 'CANCELLED');
    if (!entry.arrived_at) throw conflict('Confirm the patient first (Confirm button in Confirm List), then add vital signs', 'TOKEN_NOT_CONFIRMED');
    const [existing] = await q('SELECT id FROM patient_vitals WHERE queue_id = ?', [id]);
    if (existing) {
      await q(`UPDATE patient_vitals SET ${VITAL_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_by = ?, updated_at = NOW() WHERE id = ?`,
        [...VITAL_FIELDS.map((f) => data[f]), req.user.id, existing.id]);
    } else {
      await insertRow(q, 'patient_vitals', {
        ...data, clinic_id: req.clinicId, queue_id: id, patient_id: entry.patient_id, recorded_by: req.user.id,
      });
    }
  });
  const [vitals] = await query(`${VITALS_SELECT} WHERE pv.queue_id = ?`, [id]);
  res.json({ vitals });
});

/* ---------- Lab reports & scans (uploaded with the vital signs) ---------- */

const ATTACH_SELECT = `
  SELECT a.id, a.queue_id, a.patient_id, a.file_type, a.category, a.file_name, a.mime_type, a.size_bytes,
         a.uploaded_at, u.name AS uploaded_by_name
    FROM patient_attachments a
    LEFT JOIN employees u ON u.id = a.uploaded_by`;

/** Reads a raw (non-JSON) request body, refusing anything over `max` bytes. */
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); reject(new HttpError(413, `File is larger than ${fileSize(max)}`, 'FILE_TOO_LARGE')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// GET /api/queue/:id/attachments – files uploaded for this queue entry (without the file contents)
router.get('/:id/attachments', requirePermission('queue.view', 'vitals.record'), async (req, res) => {
  const id = toId(req.params.id);
  const rows = await query(`${ATTACH_SELECT} WHERE a.queue_id = ? AND a.clinic_id = ? ORDER BY a.uploaded_at DESC, a.id DESC`, [id, req.clinicId]);
  res.json({ rows });
});

// POST /api/queue/:id/attachments?type=photo|pdf&category=&name=  (body: the file itself, Content-Type: its mime type)
router.post('/:id/attachments', requirePermission('vitals.record'), async (req, res) => {
  const id = toId(req.params.id);
  const type = String(req.query.type || '');
  const category = String(req.query.category || '').trim() || null;
  const name = String(req.query.name || '').trim().slice(0, 200) || 'file';
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  const [entry] = await query('SELECT id, patient_id, status, arrived_at FROM queue_entries WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!entry) throw notFound('Queue entry');
  if (entry.status === 'cancelled') throw conflict('This queue entry is cancelled', 'CANCELLED');
  if (!entry.arrived_at) throw conflict('Confirm the patient first (Confirm button in Confirm List), then add reports', 'TOKEN_NOT_CONFIRMED');
  const early = checkAttachment({ type, mime, size: Number(req.headers['content-length']) || 1, category });
  if (early) throw badRequest(ATTACHMENT_ERRORS[early], 'VALIDATION');

  const data = await readRaw(req, MAX_ATTACHMENT_BYTES);
  const err = checkAttachment({ type, mime, size: data.length, category }) || (sniffMime(data) !== mime ? 'mismatch' : null);
  if (err) throw badRequest(ATTACHMENT_ERRORS[err], 'VALIDATION');

  const newId = await insertRow(query, 'patient_attachments', {
    clinic_id: req.clinicId, patient_id: entry.patient_id, queue_id: id, file_type: type, category,
    file_name: name, mime_type: mime, size_bytes: data.length, data, uploaded_by: req.user.id,
  });
  const [row] = await query(`${ATTACH_SELECT} WHERE a.id = ?`, [newId]);
  res.status(201).json(row);
});

// GET /api/queue/attachments/:attId/file – the file itself (opened in the browser)
router.get('/attachments/:attId/file', requirePermission('queue.view', 'vitals.record', 'visit.examine'), async (req, res) => {
  const attId = toId(req.params.attId);
  const [a] = await query('SELECT file_name, mime_type, data FROM patient_attachments WHERE id = ? AND clinic_id = ?', [attId, req.clinicId]);
  if (!a) throw notFound('File');
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('Content-Length', a.data.length);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(a.data);
});

// DELETE /api/queue/attachments/:attId
router.delete('/attachments/:attId', requirePermission('vitals.record'), async (req, res) => {
  const attId = toId(req.params.attId);
  const result = await query('DELETE FROM patient_attachments WHERE id = ? AND clinic_id = ?', [attId, req.clinicId]);
  if (!result.affectedRows) throw notFound('File');
  res.json({ ok: true });
});

export default router;
