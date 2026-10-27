// Doctor: Examine + Patient History
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, updateRow, isDuplicateKey } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, conflict, notFound, pick, toAmount, toId } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';
import { cleanDosage, cleanOrder, defaultsFor, dosageOptions, MAX_ORDER, nextOrder, RX_LIST_KINDS } from '../../../../shared/dosage.js';
import { cleanDosDonts, parseDosDonts } from '../../../../shared/dosdonts.js';
import { cleanPastHistory, parsePastHistory, pastQuestionDefaults } from '../../../../shared/pastHistory.js';
import { checkComparative } from '../../../../shared/comparative.js';
import { cleanChartValues } from '../../../../shared/daybook.js';

const router = Router();
router.use(clinicScope());

/**
 * Past History / Medical History of a visit (column = 'past_history' | 'medical_history'): the visit's own;
 * never saved yet → the patient's latest earlier visit that has one, and visit[column + '_from'] = its date.
 */
async function carryForward(visit, clinicId, column) {
  visit[`${column}_from`] = null;
  if (visit[column] != null) { visit[column] = parsePastHistory(visit[column]); return; }
  const [prev] = await query(
    `SELECT TOP 1 visit_date, ${column} AS saved FROM visits
      WHERE patient_id = ? AND clinic_id = ? AND ${column} IS NOT NULL AND id <> ?
        AND (visit_date < ? OR (visit_date = ? AND id < ?))
      ORDER BY visit_date DESC, id DESC`,
    [visit.patient_id, clinicId, visit.id, visit.visit_date, visit.visit_date, visit.id],
  );
  visit[column] = prev ? parsePastHistory(prev.saved) : [];
  if (visit[column].length) visit[`${column}_from`] = prev.visit_date;
}

/** Day Book → Routine (multi-select): saved as a JSON list; plain text from before counts as one routine. */
function parseRoutines(raw) {
  if (!raw) return [];
  if (String(raw).startsWith('[')) { try { return JSON.parse(raw).filter((r) => typeof r === 'string'); } catch { return []; } }
  return [String(raw)];
}
/** Day Book chart boxes: saved as JSON { key: text }; {} when none. */
function parseChart(raw) {
  if (!raw) return {};
  try { return cleanChartValues(JSON.parse(raw)); } catch { return {}; }
}
function cleanRoutines(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [list]).map(cleanDosage).filter((r) => r && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase())).slice(0, 20);
}

async function loadVisit(clinicId, id) {
  const [visit] = await query(
    `SELECT v.*, p.patient_code, p.name AS patient_name, p.gender, p.age_years, p.dob, p.mobile, p.blood_group,
            d.name AS doctor_name, d.qualification AS doctor_qualification, d.designation AS doctor_designation,
            q.token_no, q.queue_date, q.status AS queue_status,
            c.name AS clinic_name, c.address AS clinic_address, c.city AS clinic_city, c.phone AS clinic_phone,
            pv.id AS vitals_id, pv.height_cm, pv.weight_kg, pv.bp_systolic, pv.bp_diastolic, pv.bp_r_systolic, pv.bp_r_diastolic, pv.pulse_bpm, pv.sugar_type, pv.sugar_value,
            pv.temperature_f, pv.comments AS vitals_comments,
            (SELECT COUNT(*) FROM pharmacy_issues pi WHERE pi.visit_id = v.id) AS issue_count,
            (SELECT TOP 1 b.id FROM bills b WHERE b.visit_id = v.id AND b.status <> 'cancelled') AS bill_id
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN clinics c ON c.id = v.clinic_id
       LEFT JOIN employees d ON d.id = v.doctor_id
       LEFT JOIN queue_entries q ON q.id = v.queue_id
       LEFT JOIN patient_vitals pv ON pv.queue_id = v.queue_id
      WHERE v.id = ? AND v.clinic_id = ?`,
    [id, clinicId],
  );
  if (!visit) return null;
  if (typeof visit.vitals === 'string') { try { visit.vitals = JSON.parse(visit.vitals); } catch { visit.vitals = null; } }
  visit.dos_donts = parseDosDonts(visit.dos_donts);
  visit.daybook_routine = parseRoutines(visit.daybook_routine);
  visit.daybook_chart = parseChart(visit.daybook_chart);
  await carryForward(visit, clinicId, 'past_history');
  await carryForward(visit, clinicId, 'medical_history');
  visit.prescriptions = await query(
    `SELECT rx.*, i.stock_qty, i.price, i.unit, i.generic_name
       FROM prescriptions rx LEFT JOIN items i ON i.id = rx.item_id
      WHERE rx.visit_id = ? AND rx.clinic_id = ? ORDER BY rx.sort_order, rx.id`,
    [id, clinicId],
  );
  return visit;
}

// POST /api/visits/start { queue_id } – doctor opens a patient from the queue
router.post('/start', requirePermission('visit.examine'), async (req, res) => {
  const queueId = toId(req.body?.queue_id, 'queue');
  const visitId = await tx(async (q) => {
    const [entry] = await q('SELECT * FROM queue_entries WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [queueId, req.clinicId]);
    if (!entry) throw notFound('Queue entry');
    if (entry.status === 'cancelled') throw badRequest('This token was cancelled', 'BAD_TRANSITION');
    const [existing] = await q('SELECT id FROM visits WHERE queue_id = ?', [queueId]);
    if (existing) return existing.id;

    const doctorId = req.user.role === 'doctor' ? req.user.id : entry.doctor_id;
    const [clinic] = await q('SELECT consultation_fee FROM clinics WHERE id = ?', [req.clinicId]);
    const newVisitId = await insertRow(q, 'visits', {
      clinic_id: req.clinicId, patient_id: entry.patient_id, queue_id: queueId, doctor_id: doctorId,
      consultation_fee: clinic.consultation_fee || 0,
    });
    await q(
      "UPDATE queue_entries SET status = 'with_doctor', called_at = COALESCE(called_at, NOW()), doctor_id = COALESCE(?, doctor_id) WHERE id = ?",
      [doctorId, queueId],
    );
    return newVisitId;
  });
  res.status(201).json(await loadVisit(req.clinicId, visitId));
});

/* ---------- lists: Potency, Dosage, Repetition (Examine → Prescription), Do's and Don'ts (Advice),
   Past History (Complaints & diagnosis) ----------
   One list per clinic and kind. A clinic gets the defaults once (is_default = 1); after that every row
   can be renamed, reordered or deleted, and new ones added. Delete only hides a row (is_deleted = 1), so
   deleted defaults don't come back; adding the same value again un-hides it.
   Prescriptions keep the text they were saved with. */
const RX_LIST_TABLE = {
  dosage: 'dosage_master', potency: 'potency_master', repetition: 'repetition_master',
  dosdont: 'dosdont_master', pasthistory: 'pasthistory_master', medhistory: 'medhistory_master',
  dbroutine: 'dbroutine_master', dbduration: 'dbduration_master', dbfrequency: 'dbfrequency_master',
};
const RX_LIST_NAME = {
  dosage: 'dosage', potency: 'potency', repetition: 'repetition', dosdont: 'item', pasthistory: 'item', medhistory: 'item',
  dbroutine: 'routine', dbduration: 'duration', dbfrequency: 'frequency',
};

async function ensureDefaults(kind, clinicId, userId) {
  const table = RX_LIST_TABLE[kind];
  const [done] = await query(`SELECT TOP 1 id FROM ${table} WHERE clinic_id = ? AND is_default = 1`, [clinicId]);
  if (done) return;
  // all defaults in one transaction; a request arriving at the same moment waits on the lock, then sees them all
  await tx(async (q) => {
    const [again] = await q(`SELECT TOP 1 id FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE clinic_id = ? AND is_default = 1`, [clinicId]);
    if (again) return;
    for (const d of defaultsFor(kind)) {
      const [same] = await q(`SELECT id FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE clinic_id = ? AND value = ?`, [clinicId, d.value]);
      if (same) await q(`UPDATE ${table} SET is_default = 1 WHERE id = ?`, [same.id]);
      else await insertRow(q, table, { clinic_id: clinicId, value: d.value, sort_order: d.sort_order, is_default: 1, created_by: userId });
    }
  });
}

/** { rows: the clinic's list by Order, added: [{ id, value, sort_order }] – every row is editable } */
async function loadOptions(kind, clinicId, userId = null) {
  await ensureDefaults(kind, clinicId, userId);
  const added = await query(
    `SELECT id, value, sort_order FROM ${RX_LIST_TABLE[kind]} WHERE clinic_id = ? AND is_deleted = 0 ORDER BY sort_order, value`, [clinicId],
  );
  return { rows: dosageOptions(added), added };
}

const readOrder = (body) => {
  if (body?.sort_order === undefined || body?.sort_order === '') return undefined;
  const order = cleanOrder(body.sort_order);
  if (order === null) throw badRequest(`Order must be a whole number from 0 to ${MAX_ORDER}`, 'VALIDATION');
  return order;
};

for (const kind of RX_LIST_KINDS) {
  const table = RX_LIST_TABLE[kind];
  const name = RX_LIST_NAME[kind];

  // GET /api/visits/{potency|dosage}-options
  router.get(`/${kind}-options`, requirePermission('visit.examine'), async (req, res) => {
    res.json(await loadOptions(kind, req.clinicId, req.user.id));
  });

  // PUT /api/visits/{kind}-options/:id { value, sort_order } – rename / reorder any row
  router.put(`/${kind}-options/:id`, requirePermission('visit.examine'), async (req, res) => {
    const id = toId(req.params.id);
    const value = cleanDosage(req.body?.value);
    if (!value) throw badRequest(`Enter the ${name}`, 'VALIDATION');
    const order = readOrder(req.body);
    const [row] = await query(`SELECT id, value, sort_order FROM ${table} WHERE id = ? AND clinic_id = ? AND is_deleted = 0`, [id, req.clinicId]);
    if (!row) throw notFound(name[0].toUpperCase() + name.slice(1));
    const { rows } = await loadOptions(kind, req.clinicId);
    const clash = rows.find((d) => d.toLowerCase() === value.toLowerCase() && d.toLowerCase() !== row.value.toLowerCase());
    if (clash) throw conflict(`"${clash}" is already in the list`, 'DUPLICATE');
    try {
      await tx(async (q) => {
        // a hidden (deleted) row with the new name is dropped, so the name is free
        await q(`DELETE FROM ${table} WHERE clinic_id = ? AND is_deleted = 1 AND value = ? AND id <> ?`, [req.clinicId, value, id]);
        await q(`UPDATE ${table} SET value = ?, sort_order = ? WHERE id = ? AND clinic_id = ?`, [value, order ?? row.sort_order, id, req.clinicId]);
      });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict(`"${value}" is already in the list`, 'DUPLICATE');
      throw e;
    }
    res.json({ value, ...(await loadOptions(kind, req.clinicId)) });
  });

  // POST /api/visits/{kind}-options { value, sort_order? } – "+ New" (without an Order it goes to the end)
  router.post(`/${kind}-options`, requirePermission('visit.examine'), async (req, res) => {
    const value = cleanDosage(req.body?.value);
    if (!value) throw badRequest(`Enter the ${name} to add`, 'VALIDATION');
    const order = readOrder(req.body);
    const { rows, added } = await loadOptions(kind, req.clinicId, req.user.id);
    const existing = rows.find((d) => d.toLowerCase() === value.toLowerCase());
    if (!existing) {
      const [hidden] = await query(`SELECT id FROM ${table} WHERE clinic_id = ? AND is_deleted = 1 AND value = ?`, [req.clinicId, value]);
      try {
        if (hidden) {                              // deleted earlier → bring it back
          await query(`UPDATE ${table} SET is_deleted = 0, value = ?, sort_order = ? WHERE id = ?`, [value, order ?? nextOrder(added), hidden.id]);
        } else {
          await insertRow(query, table, { clinic_id: req.clinicId, value, sort_order: order ?? nextOrder(added), created_by: req.user.id });
        }
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;          // added at the same moment by someone else
      }
    }
    res.status(existing ? 200 : 201).json({ value: existing || value, ...(await loadOptions(kind, req.clinicId)) });
  });

  // DELETE /api/visits/{kind}-options/:id – remove from the list (hidden; prescriptions keep their text)
  router.delete(`/${kind}-options/:id`, requirePermission('visit.examine'), async (req, res) => {
    const id = toId(req.params.id);
    const r = await query(`UPDATE ${table} SET is_deleted = 1 WHERE id = ? AND clinic_id = ? AND is_deleted = 0`, [id, req.clinicId]);
    if (!r.affectedRows) throw notFound(name[0].toUpperCase() + name.slice(1));
    res.json(await loadOptions(kind, req.clinicId));
  });
}

/* ---------- Past History questions: one list per Past History item (ENT → Symptom Character, …) ----------
   Same behaviour as the lists above; an item gets its default questions once (ENT has seven, others none).
   Answers are saved as text on the patient, so they stay even if a question is later renamed or deleted. */
const PHQ = 'pasthistory_question';

async function pastItem(clinicId, itemId) {
  const [item] = await query('SELECT id, value FROM pasthistory_master WHERE id = ? AND clinic_id = ? AND is_deleted = 0', [itemId, clinicId]);
  if (!item) throw notFound('Past History item');
  return item;
}

async function ensureQuestionDefaults(clinicId, item, userId) {
  const defaults = pastQuestionDefaults(item.value);
  if (!defaults.length) return;
  const [done] = await query(`SELECT TOP 1 id FROM ${PHQ} WHERE item_id = ? AND is_default = 1`, [item.id]);
  if (done) return;
  await tx(async (q) => {
    const [again] = await q(`SELECT TOP 1 id FROM ${PHQ} WITH (UPDLOCK, HOLDLOCK) WHERE item_id = ? AND is_default = 1`, [item.id]);
    if (again) return;
    for (const d of defaults) {
      const [same] = await q(`SELECT id FROM ${PHQ} WITH (UPDLOCK, HOLDLOCK) WHERE item_id = ? AND value = ?`, [item.id, d.value]);
      if (same) await q(`UPDATE ${PHQ} SET is_default = 1 WHERE id = ?`, [same.id]);
      else await insertRow(q, PHQ, { clinic_id: clinicId, item_id: item.id, value: d.value, sort_order: d.sort_order, is_default: 1, created_by: userId });
    }
  });
}

/** { rows: the item's questions by Order, added: [{ id, value, sort_order }] } */
async function loadQuestions(clinicId, item, userId = null) {
  await ensureQuestionDefaults(clinicId, item, userId);
  const added = await query(
    `SELECT id, value, sort_order FROM ${PHQ} WHERE item_id = ? AND clinic_id = ? AND is_deleted = 0 ORDER BY sort_order, value`, [item.id, clinicId],
  );
  return { rows: dosageOptions(added), added };
}

// GET /api/visits/pasthistory-questions – every item's questions: { [itemId]: { rows, added } }
router.get('/pasthistory-questions', requirePermission('visit.examine'), async (req, res) => {
  const { added: items } = await loadOptions('pasthistory', req.clinicId, req.user.id);
  const out = {};
  for (const item of items) out[item.id] = await loadQuestions(req.clinicId, item, req.user.id);
  res.json(out);
});

// POST /api/visits/pasthistory-questions/:itemId { value, sort_order? } – "+ New" question for an item
router.post('/pasthistory-questions/:itemId', requirePermission('visit.examine'), async (req, res) => {
  const item = await pastItem(req.clinicId, toId(req.params.itemId));
  const value = cleanDosage(req.body?.value);
  if (!value) throw badRequest('Enter the question to add', 'VALIDATION');
  const order = readOrder(req.body);
  const { rows, added } = await loadQuestions(req.clinicId, item, req.user.id);
  const existing = rows.find((d) => d.toLowerCase() === value.toLowerCase());
  if (!existing) {
    const [hidden] = await query(`SELECT id FROM ${PHQ} WHERE item_id = ? AND is_deleted = 1 AND value = ?`, [item.id, value]);
    try {
      if (hidden) await query(`UPDATE ${PHQ} SET is_deleted = 0, value = ?, sort_order = ? WHERE id = ?`, [value, order ?? nextOrder(added), hidden.id]);
      else await insertRow(query, PHQ, { clinic_id: req.clinicId, item_id: item.id, value, sort_order: order ?? nextOrder(added), created_by: req.user.id });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  res.status(existing ? 200 : 201).json({ value: existing || value, ...(await loadQuestions(req.clinicId, item)) });
});

// PUT /api/visits/pasthistory-questions/:itemId/:id { value, sort_order } – rename / reorder a question
router.put('/pasthistory-questions/:itemId/:id', requirePermission('visit.examine'), async (req, res) => {
  const item = await pastItem(req.clinicId, toId(req.params.itemId));
  const id = toId(req.params.id);
  const value = cleanDosage(req.body?.value);
  if (!value) throw badRequest('Enter the question', 'VALIDATION');
  const order = readOrder(req.body);
  const [row] = await query(`SELECT id, value, sort_order FROM ${PHQ} WHERE id = ? AND item_id = ? AND clinic_id = ? AND is_deleted = 0`, [id, item.id, req.clinicId]);
  if (!row) throw notFound('Question');
  const { rows } = await loadQuestions(req.clinicId, item);
  const clash = rows.find((d) => d.toLowerCase() === value.toLowerCase() && d.toLowerCase() !== row.value.toLowerCase());
  if (clash) throw conflict(`"${clash}" is already in the list`, 'DUPLICATE');
  try {
    await tx(async (q) => {
      await q(`DELETE FROM ${PHQ} WHERE item_id = ? AND is_deleted = 1 AND value = ? AND id <> ?`, [item.id, value, id]);
      await q(`UPDATE ${PHQ} SET value = ?, sort_order = ? WHERE id = ?`, [value, order ?? row.sort_order, id]);
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict(`"${value}" is already in the list`, 'DUPLICATE');
    throw e;
  }
  res.json({ value, ...(await loadQuestions(req.clinicId, item)) });
});

// DELETE /api/visits/pasthistory-questions/:itemId/:id – remove a question (hidden; answers keep their text)
router.delete('/pasthistory-questions/:itemId/:id', requirePermission('visit.examine'), async (req, res) => {
  const item = await pastItem(req.clinicId, toId(req.params.itemId));
  const r = await query(`UPDATE ${PHQ} SET is_deleted = 1 WHERE id = ? AND item_id = ? AND clinic_id = ? AND is_deleted = 0`,
    [toId(req.params.id), item.id, req.clinicId]);
  if (!r.affectedRows) throw notFound('Question');
  res.json(await loadQuestions(req.clinicId, item));
});

/* ---------- Comparative Study: one running table per patient (Date, Time, Rt.H, Lt.H) ----------
   Each add / edit / delete is saved right away (not with Save draft). */
const COMPARATIVE_ERR = { date: 'Enter a valid date', reading: 'Enter Rt.H or Lt.H' };
const readComparative = (body) => {
  const { row, error } = checkComparative(body || {});
  if (error) throw badRequest(COMPARATIVE_ERR[error], 'VALIDATION');
  return row;
};
const listComparative = (clinicId, patientId) => query(
  `SELECT id, visit_id, study_date, study_time, rt_h, lt_h FROM comparative_study
    WHERE clinic_id = ? AND patient_id = ? ORDER BY study_date, id`, [clinicId, patientId],   // typed times do not sort as text
);

// GET /api/visits/patient/:patientId/comparative
router.get('/patient/:patientId/comparative', requirePermission('visit.examine', 'patient.history'), async (req, res) => {
  res.json({ rows: await listComparative(req.clinicId, toId(req.params.patientId, 'patient')) });
});

// POST /api/visits/patient/:patientId/comparative { study_date, study_time, rt_h, lt_h, visit_id? }
router.post('/patient/:patientId/comparative', requirePermission('visit.examine'), async (req, res) => {
  const patientId = toId(req.params.patientId, 'patient');
  const [patient] = await query('SELECT id FROM patients WHERE id = ? AND clinic_id = ?', [patientId, req.clinicId]);
  if (!patient) throw notFound('Patient');
  const row = readComparative(req.body);
  let visitId = null;
  if (req.body?.visit_id) {
    const [v] = await query('SELECT id FROM visits WHERE id = ? AND clinic_id = ? AND patient_id = ?', [toId(req.body.visit_id, 'visit'), req.clinicId, patientId]);
    visitId = v?.id ?? null;
  }
  await insertRow(query, 'comparative_study', { clinic_id: req.clinicId, patient_id: patientId, visit_id: visitId, ...row, created_by: req.user.id });
  res.status(201).json({ rows: await listComparative(req.clinicId, patientId) });
});

// PUT /api/visits/comparative/:id { study_date, study_time, rt_h, lt_h }
router.put('/comparative/:id', requirePermission('visit.examine'), async (req, res) => {
  const id = toId(req.params.id);
  const [old] = await query('SELECT id, patient_id FROM comparative_study WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!old) throw notFound('Comparative Study row');
  const row = readComparative(req.body);
  await query(
    'UPDATE comparative_study SET study_date = ?, study_time = ?, rt_h = ?, lt_h = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
    [row.study_date, row.study_time, row.rt_h, row.lt_h, req.user.id, id],
  );
  res.json({ rows: await listComparative(req.clinicId, old.patient_id) });
});

// DELETE /api/visits/comparative/:id
router.delete('/comparative/:id', requirePermission('visit.examine'), async (req, res) => {
  const id = toId(req.params.id);
  const [old] = await query('SELECT id, patient_id FROM comparative_study WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
  if (!old) throw notFound('Comparative Study row');
  await query('DELETE FROM comparative_study WHERE id = ?', [id]);
  res.json({ rows: await listComparative(req.clinicId, old.patient_id) });
});

// GET /api/visits/patient/:patientId – Patient History (all visits + prescriptions)
router.get('/patient/:patientId', requirePermission('patient.history'), async (req, res) => {
  const patientId = toId(req.params.patientId, 'patient');
  const [patient] = await query(
    'SELECT id, patient_code, name, gender, age_years, dob, mobile, blood_group, address FROM patients WHERE id = ? AND clinic_id = ?',
    [patientId, req.clinicId],
  );
  if (!patient) throw notFound('Patient');
  const visits = await query(
    `SELECT v.id, v.visit_date, v.complaints, v.examination_notes, v.diagnosis, v.vitals, v.advice, v.advice_unwilling, v.rx_unwilling, v.daybook_date, v.daybook_routine, v.daybook_duration, v.daybook_frequency, v.follow_up_date,
            v.dos_donts, v.past_history, v.medical_history, v.consultation_fee, v.status, v.queue_id, d.name AS doctor_name, q.token_no,
            pv.height_cm, pv.weight_kg, pv.bp_systolic, pv.bp_diastolic, pv.bp_r_systolic, pv.bp_r_diastolic, pv.pulse_bpm, pv.temperature_f, pv.sugar_type, pv.sugar_value,
            pv.comments AS vitals_comments, pv.id AS vitals_id
       FROM visits v LEFT JOIN employees d ON d.id = v.doctor_id LEFT JOIN queue_entries q ON q.id = v.queue_id
       LEFT JOIN patient_vitals pv ON pv.queue_id = v.queue_id
      WHERE v.patient_id = ? AND v.clinic_id = ? ORDER BY v.visit_date DESC`,
    [patientId, req.clinicId],
  );
  if (visits.length) {
    const rx = await query(
      'SELECT * FROM prescriptions WHERE visit_id IN (?) AND clinic_id = ? ORDER BY sort_order, id',
      [visits.map((v) => v.id), req.clinicId],
    );
    for (const v of visits) {
      if (typeof v.vitals === 'string') { try { v.vitals = JSON.parse(v.vitals); } catch { v.vitals = null; } }
      v.dos_donts = parseDosDonts(v.dos_donts);
      v.daybook_routine = parseRoutines(v.daybook_routine);
      v.past_history = parsePastHistory(v.past_history);
      v.medical_history = parsePastHistory(v.medical_history);
      v.prescriptions = rx.filter((r) => r.visit_id === v.id);
    }
  }
  res.json({ patient, visits });
});

router.get('/:id', requirePermission('visit.examine', 'patient.history', 'dispense', 'bill.create'), async (req, res) => {
  const visit = await loadVisit(req.clinicId, toId(req.params.id));
  if (!visit) throw notFound('Visit');
  res.json(visit);
});

// PUT /api/visits/:id – save examination; { ..., prescriptions: [...], complete: true } finishes the visit
router.put('/:id', requirePermission('visit.examine'), async (req, res) => {
  const id = toId(req.params.id);
  const body = req.body || {};
  const data = pick(body, ['complaints', 'examination_notes', 'diagnosis', 'advice', 'follow_up_date']);
  if (data.follow_up_date && !isISODate(data.follow_up_date)) throw badRequest('Invalid follow-up date', 'VALIDATION');
  if (body.consultation_fee !== undefined) data.consultation_fee = toAmount(body.consultation_fee, 'consultation_fee');
  if (body.advice_unwilling !== undefined) data.advice_unwilling = !!body.advice_unwilling;
  if (body.rx_unwilling !== undefined) data.rx_unwilling = !!body.rx_unwilling;
  // Day Book: one row per visit, each value as picked (or typed) from its list
  if (body.daybook_routine !== undefined) {
    const routines = cleanRoutines(body.daybook_routine);
    data.daybook_routine = routines.length ? JSON.stringify(routines) : null;
  }
  for (const k of ['daybook_duration', 'daybook_frequency']) {
    if (body[k] !== undefined) data[k] = cleanDosage(body[k]) || null;
  }
  if (body.daybook_chart !== undefined) {
    const cells = cleanChartValues(body.daybook_chart);
    data.daybook_chart = Object.keys(cells).length ? JSON.stringify(cells) : null;
  }
  if (body.daybook_date !== undefined) {
    if (body.daybook_date && !isISODate(body.daybook_date)) throw badRequest('Invalid Day Book date', 'VALIDATION');
    data.daybook_date = body.daybook_date || null;
  }
  if (body.vitals !== undefined) data.vitals = body.vitals ? JSON.stringify(body.vitals) : null;
  if (body.dos_donts !== undefined) {
    const marks = cleanDosDonts(body.dos_donts);
    data.dos_donts = marks.length ? JSON.stringify(marks) : null;
  }
  // Past History of this visit; '[]' (not NULL) when nothing is ticked, so it does not refill from the last visit
  if (body.past_history !== undefined) data.past_history = JSON.stringify(cleanPastHistory(body.past_history));
  if (body.medical_history !== undefined) data.medical_history = JSON.stringify(cleanPastHistory(body.medical_history));

  await tx(async (q) => {
    const [visit] = await q('SELECT * FROM visits WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [id, req.clinicId]);
    if (!visit) throw notFound('Visit');
    const [billed] = await q("SELECT TOP 1 id FROM bills WHERE visit_id = ? AND status <> 'cancelled'", [id]);
    if (billed && data.consultation_fee !== undefined && data.consultation_fee !== Number(visit.consultation_fee)) {
      throw conflict('Visit is already billed – fee cannot change', 'BILLED');
    }

    if (Array.isArray(body.prescriptions)) {
      const [{ n }] = await q('SELECT COUNT(*) AS n FROM pharmacy_issues WHERE visit_id = ?', [id]);
      if (n > 0) throw conflict('Medicines already issued by pharmacy – prescription is locked', 'RX_LOCKED');
      await q('DELETE FROM prescriptions WHERE visit_id = ? AND clinic_id = ?', [id, req.clinicId]);

      let order = 0;
      for (const line of body.prescriptions) {
        const name = String(line.medicine_name || '').trim();
        if (!name) continue;
        let itemId = null;
        if (line.item_id) {
          const [item] = await q('SELECT id FROM items WHERE id = ? AND clinic_id = ?', [toId(line.item_id, 'item'), req.clinicId]);
          if (!item) throw badRequest(`Item for "${name}" not found in this clinic`, 'VALIDATION');
          itemId = item.id;
        }
        const qty = toAmount(line.quantity ?? 1, 'quantity');
        await insertRow(q, 'prescriptions', {
          clinic_id: req.clinicId, visit_id: id, item_id: itemId, medicine_name: name.slice(0, 200),
          potency: line.potency ? String(line.potency).trim().slice(0, 100) : null,
          dosage: line.dosage || null, frequency: line.frequency || null, duration: line.duration || null,
          quantity: qty || 1, instructions: line.instructions || null, sort_order: order++,
        });
      }
    }

    if (body.complete) data.status = 'completed';
    if (Object.keys(data).length) await updateRow(q, 'visits', data, 'id = ?', [id]);
    if (body.complete && visit.queue_id) {
      await q("UPDATE queue_entries SET status = 'done', completed_at = NOW() WHERE id = ? AND status <> 'cancelled'", [visit.queue_id]);
    }
  });
  res.json(await loadVisit(req.clinicId, id));
});

export default router;
