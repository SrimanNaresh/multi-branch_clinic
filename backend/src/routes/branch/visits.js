// Doctor: Examine + Patient History
import { Router } from '../../lib/mini-express.js';
import { query, tx } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, conflict, notFound, pick, toAmount, toId } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope());

async function loadVisit(clinicId, id) {
  const [visit] = await query(
    `SELECT v.*, p.patient_code, p.name AS patient_name, p.gender, p.age_years, p.dob, p.mobile, p.blood_group,
            d.name AS doctor_name, q.token_no, q.queue_date,
            (SELECT COUNT(*) FROM pharmacy_issues pi WHERE pi.visit_id = v.id) AS issue_count,
            (SELECT b.id FROM bills b WHERE b.visit_id = v.id AND b.status <> 'cancelled' LIMIT 1) AS bill_id
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       LEFT JOIN employees d ON d.id = v.doctor_id
       LEFT JOIN queue_entries q ON q.id = v.queue_id
      WHERE v.id = ? AND v.clinic_id = ?`,
    [id, clinicId],
  );
  if (!visit) return null;
  if (typeof visit.vitals === 'string') visit.vitals = JSON.parse(visit.vitals);
  visit.prescriptions = await query(
    `SELECT rx.*, i.stock_qty, i.price, i.unit
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
    const [entry] = await q('SELECT * FROM queue_entries WHERE id = ? AND clinic_id = ? FOR UPDATE', [queueId, req.clinicId]);
    if (!entry) throw notFound('Queue entry');
    if (entry.status === 'cancelled') throw badRequest('This token was cancelled', 'BAD_TRANSITION');
    const [existing] = await q('SELECT id FROM visits WHERE queue_id = ?', [queueId]);
    if (existing) return existing.id;

    const doctorId = req.user.role === 'doctor' ? req.user.id : entry.doctor_id;
    const [clinic] = await q('SELECT consultation_fee FROM clinics WHERE id = ?', [req.clinicId]);
    const r = await q('INSERT INTO visits SET ?', [{
      clinic_id: req.clinicId, patient_id: entry.patient_id, queue_id: queueId, doctor_id: doctorId,
      consultation_fee: clinic.consultation_fee || 0,
    }]);
    await q(
      "UPDATE queue_entries SET status = 'with_doctor', called_at = COALESCE(called_at, NOW()), doctor_id = COALESCE(?, doctor_id) WHERE id = ?",
      [doctorId, queueId],
    );
    return r.insertId;
  });
  res.status(201).json(await loadVisit(req.clinicId, visitId));
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
    `SELECT v.id, v.visit_date, v.complaints, v.examination_notes, v.diagnosis, v.vitals, v.advice, v.follow_up_date,
            v.consultation_fee, v.status, d.name AS doctor_name, q.token_no
       FROM visits v LEFT JOIN employees d ON d.id = v.doctor_id LEFT JOIN queue_entries q ON q.id = v.queue_id
      WHERE v.patient_id = ? AND v.clinic_id = ? ORDER BY v.visit_date DESC`,
    [patientId, req.clinicId],
  );
  if (visits.length) {
    const rx = await query(
      'SELECT * FROM prescriptions WHERE visit_id IN (?) AND clinic_id = ? ORDER BY sort_order, id',
      [visits.map((v) => v.id), req.clinicId],
    );
    for (const v of visits) {
      if (typeof v.vitals === 'string') v.vitals = JSON.parse(v.vitals);
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
    const [visit] = await q('SELECT * FROM visits WHERE id = ? AND clinic_id = ? FOR UPDATE', [id, req.clinicId]);
    if (!visit) throw notFound('Visit');
    const [billed] = await q("SELECT id FROM bills WHERE visit_id = ? AND status <> 'cancelled' LIMIT 1", [id]);
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
        await q('INSERT INTO prescriptions SET ?', [{
          clinic_id: req.clinicId, visit_id: id, item_id: itemId, medicine_name: name.slice(0, 200),
          dosage: line.dosage || null, frequency: line.frequency || null, duration: line.duration || null,
          quantity: qty || 1, instructions: line.instructions || null, sort_order: order++,
        }]);
      }
    }

    if (body.complete) data.status = 'completed';
    if (Object.keys(data).length) await q('UPDATE visits SET ? WHERE id = ?', [data, id]);
    if (body.complete && visit.queue_id) {
      await q("UPDATE queue_entries SET status = 'done', completed_at = NOW() WHERE id = ? AND status <> 'cancelled'", [visit.queue_id]);
    }
  });
  res.json(await loadVisit(req.clinicId, id));
});

export default router;
