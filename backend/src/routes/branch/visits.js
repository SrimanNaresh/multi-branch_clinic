// Doctor: Examine + Patient History
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, updateRow, isDuplicateKey } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, conflict, notFound, pick, toAmount, toId } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';
import { cleanDosage, cleanOrder, defaultsFor, dosageOptions, MAX_ORDER, nextOrder, RX_LIST_KINDS } from '../../../../shared/dosage.js';

const router = Router();
router.use(clinicScope());

async function loadVisit(clinicId, id) {
  const [visit] = await query(
    `SELECT v.*, p.patient_code, p.name AS patient_name, p.gender, p.age_years, p.dob, p.mobile, p.blood_group,
            d.name AS doctor_name, d.qualification AS doctor_qualification, d.designation AS doctor_designation,
            q.token_no, q.queue_date, q.status AS queue_status,
            c.name AS clinic_name, c.address AS clinic_address, c.city AS clinic_city, c.phone AS clinic_phone,
            pv.id AS vitals_id, pv.height_cm, pv.weight_kg, pv.bp_systolic, pv.bp_diastolic, pv.pulse_bpm,
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

/* ---------- prescription lists: Potency, Dosage, Repetition (Examine → Prescription) ----------
   One list per clinic and kind. A clinic gets the defaults once (is_default = 1); after that every row
   can be renamed, reordered or deleted, and new ones added. Delete only hides a row (is_deleted = 1), so
   deleted defaults don't come back; adding the same value again un-hides it.
   Prescriptions keep the text they were saved with. */
const RX_LIST_TABLE = { dosage: 'dosage_master', potency: 'potency_master', repetition: 'repetition_master' };
const RX_LIST_NAME = { dosage: 'dosage', potency: 'potency', repetition: 'repetition' };

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

// GET /api/visits/patient/:patientId – Patient History (all visits + prescriptions)
router.get('/patient/:patientId', requirePermission('patient.history'), async (req, res) => {
  const patientId = toId(req.params.patientId, 'patient');
  const [patient] = await query(
    'SELECT id, patient_code, name, gender, age_years, dob, mobile, blood_group, address FROM patients WHERE id = ? AND clinic_id = ?',
    [patientId, req.clinicId],
  );
  if (!patient) throw notFound('Patient');
  const visits = await query(
    `SELECT v.id, v.visit_date, v.complaints, v.examination_notes, v.diagnosis, v.vitals, v.advice, v.follow_up_date,
            v.consultation_fee, v.status, d.name AS doctor_name, q.token_no,
            pv.height_cm, pv.weight_kg, pv.bp_systolic, pv.bp_diastolic, pv.pulse_bpm, pv.temperature_f,
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
  if (body.vitals !== undefined) data.vitals = body.vitals ? JSON.stringify(body.vitals) : null;

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
