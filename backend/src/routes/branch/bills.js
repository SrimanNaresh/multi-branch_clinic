// Billing: Patient Bill = consultation fee + issued (unbilled) pharmacy items + extra lines
import { Router } from 'express';
import { query, tx } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { nextSequence, formatBillNo } from '../../utils/codes.js';
import { badRequest, conflict, notFound, oneOf, paging, toAmount, toId, like } from '../../utils/http.js';
import { addDays, isISODate, todayISO } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope());

const round2 = (n) => Math.round(n * 100) / 100;

/** Lines the bill would contain for a visit, computed from the DB (never trusted from the client). */
async function draftForVisit(q, clinicId, visitId, { lock = false } = {}) {
  const [visit] = await q(
    `SELECT v.id, v.patient_id, v.consultation_fee, v.visit_date, p.name AS patient_name, p.patient_code, p.mobile
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ? AND v.clinic_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [visitId, clinicId],
  );
  if (!visit) throw notFound('Visit');
  const [consultBilled] = await q(
    `SELECT b.id FROM bills b JOIN bill_items bi ON bi.bill_id = b.id
      WHERE b.visit_id = ? AND b.status <> 'cancelled' AND bi.line_type = 'consultation' LIMIT 1`,
    [visitId],
  );
  const issues = await q(
    `SELECT id FROM pharmacy_issues WHERE visit_id = ? AND clinic_id = ? AND status = 'issued' AND bill_id IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [visitId, clinicId],
  );
  const lines = [];
  if (!consultBilled && Number(visit.consultation_fee) > 0) {
    lines.push({ line_type: 'consultation', item_id: null, description: 'Consultation fee', qty: 1,
      rate: Number(visit.consultation_fee), gst_percent: 0, amount: Number(visit.consultation_fee) });
  }
  if (issues.length) {
    const items = await q(
      `SELECT pii.item_id, i.name, i.unit, pii.qty, pii.rate, pii.gst_percent, pii.amount
         FROM pharmacy_issue_items pii JOIN items i ON i.id = pii.item_id
        WHERE pii.issue_id IN (?) ORDER BY pii.id`,
      [issues.map((i) => i.id)],
    );
    for (const it of items) {
      lines.push({ line_type: 'medicine', item_id: it.item_id, description: `${it.name}${it.unit ? ` (${it.unit})` : ''}`,
        qty: Number(it.qty), rate: Number(it.rate), gst_percent: Number(it.gst_percent), amount: Number(it.amount) });
    }
  }
  return { visit, lines, issueIds: issues.map((i) => i.id), consultationBilled: !!consultBilled };
}

const q0 = (sql, params) => query(sql, params);

// GET /api/bills/pending?date= – visits of the day with something left to bill
router.get('/pending', requirePermission('bill.create'), async (req, res) => {
  const day = isISODate(req.query.date) ? req.query.date : todayISO();
  const rows = await query(
    `SELECT v.id AS visit_id, v.visit_date, v.status AS visit_status, v.consultation_fee, q.token_no,
            p.id AS patient_id, p.patient_code, p.name AS patient_name, p.mobile,
            (SELECT COALESCE(SUM(pi.items_total), 0) FROM pharmacy_issues pi
              WHERE pi.visit_id = v.id AND pi.status = 'issued' AND pi.bill_id IS NULL) AS unbilled_items,
            (SELECT COUNT(*) FROM bills b WHERE b.visit_id = v.id AND b.status <> 'cancelled') AS bill_count
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN queue_entries q ON q.id = v.queue_id
      WHERE v.clinic_id = ? AND v.visit_date >= ? AND v.visit_date < ?
      ORDER BY q.token_no, v.id`,
    [req.clinicId, day, addDays(day, 1)],
  );
  res.json({ date: day, rows: rows.filter((r) => r.bill_count === 0 || Number(r.unbilled_items) > 0) });
});

// GET /api/bills/draft/:visitId – preview of what the bill will contain
router.get('/draft/:visitId', requirePermission('bill.create'), async (req, res) => {
  const d = await draftForVisit(q0, req.clinicId, toId(req.params.visitId, 'visit'));
  res.json({ visit: d.visit, lines: d.lines, consultation_billed: d.consultationBilled });
});

// POST /api/bills { visit_id? | patient_id, extra_lines: [{description, qty, rate}], discount, paid_amount, payment_mode, notes }
router.post('/', requirePermission('bill.create'), async (req, res) => {
  const body = req.body || {};
  const paymentMode = body.payment_mode || 'cash';
  oneOf(paymentMode, ['cash', 'card', 'upi', 'other'], 'payment_mode');
  const discount = toAmount(body.discount, 'discount');
  const extra = (Array.isArray(body.extra_lines) ? body.extra_lines : [])
    .filter((l) => String(l.description || '').trim())
    .map((l) => {
      const qty = toAmount(l.qty ?? 1, 'qty') || 1;
      const rate = toAmount(l.rate, 'rate');
      return { line_type: 'other', item_id: null, description: String(l.description).trim().slice(0, 200), qty, rate, gst_percent: 0, amount: round2(qty * rate) };
    });

  const billId = await tx(async (q) => {
    let patientId;
    let visitId = null;
    let lines = [];
    let issueIds = [];
    if (body.visit_id) {
      visitId = toId(body.visit_id, 'visit');
      const d = await draftForVisit(q, req.clinicId, visitId, { lock: true });
      patientId = d.visit.patient_id;
      lines = d.lines;
      issueIds = d.issueIds;
    } else {
      patientId = toId(body.patient_id, 'patient');
      const [p] = await q('SELECT id FROM patients WHERE id = ? AND clinic_id = ?', [patientId, req.clinicId]);
      if (!p) throw notFound('Patient');
    }
    lines = [...lines, ...extra];
    if (!lines.length) throw conflict('Nothing to bill for this visit', 'NOTHING_TO_BILL');

    const sum = (type) => round2(lines.filter((l) => l.line_type === type).reduce((s, l) => s + l.amount, 0));
    const consultation = sum('consultation');
    const itemsTotal = sum('medicine');
    const otherTotal = sum('other');
    const gross = round2(consultation + itemsTotal + otherTotal);
    if (discount > gross) throw badRequest('Discount is more than the bill amount', 'VALIDATION');
    const net = round2(gross - discount);
    const paid = body.paid_amount === undefined || body.paid_amount === null || body.paid_amount === '' ? net : toAmount(body.paid_amount, 'paid_amount');
    if (paid > net) throw badRequest('Paid amount is more than the bill amount', 'VALIDATION');
    const status = paid >= net ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const billNo = formatBillNo(clinic.code, await nextSequence(q, req.clinicId, 'bill'));
    const r = await q('INSERT INTO bills SET ?', [{
      clinic_id: req.clinicId, bill_no: billNo, patient_id: patientId, visit_id: visitId,
      consultation_fee: consultation, items_total: itemsTotal, other_total: otherTotal, discount,
      tax_total: 0, net_amount: net, paid_amount: paid, payment_mode: paymentMode, status,
      notes: body.notes ? String(body.notes).slice(0, 300) : null, created_by: req.user.id,
    }]);
    for (const l of lines) await q('INSERT INTO bill_items SET ?', [{ ...l, clinic_id: req.clinicId, bill_id: r.insertId }]);
    if (issueIds.length) {
      await q("UPDATE pharmacy_issues SET status = 'billed', bill_id = ? WHERE id IN (?)", [r.insertId, issueIds]);
    }
    return r.insertId;
  });
  res.status(201).json(await loadBill(req.clinicId, billId));
});

async function loadBill(clinicId, id) {
  const [bill] = await query(
    `SELECT b.*, p.patient_code, p.name AS patient_name, p.mobile, p.address AS patient_address, p.gender, p.age_years,
            c.name AS clinic_name, c.code AS clinic_code, c.address AS clinic_address, c.city AS clinic_city, c.phone AS clinic_phone,
            e.name AS created_by_name, d.name AS doctor_name
       FROM bills b
       JOIN patients p ON p.id = b.patient_id
       JOIN clinics c ON c.id = b.clinic_id
       LEFT JOIN employees e ON e.id = b.created_by
       LEFT JOIN visits v ON v.id = b.visit_id
       LEFT JOIN employees d ON d.id = v.doctor_id
      WHERE b.id = ? AND b.clinic_id = ?`,
    [id, clinicId],
  );
  if (!bill) return null;
  bill.items = await query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [id]);
  return bill;
}

// GET /api/bills?from=&to=&q=&page=
router.get('/', requirePermission('bill.view'), async (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const from = isISODate(req.query.from) ? req.query.from : todayISO();
  const to = isISODate(req.query.to) ? req.query.to : from;
  const where = ['b.clinic_id = ?', 'b.bill_date >= ?', 'b.bill_date < ?'];
  const params = [req.clinicId, from, addDays(to, 1)];
  if (req.query.q) {
    where.push('(b.bill_no LIKE ? OR p.name LIKE ? OR p.mobile LIKE ? OR p.patient_code LIKE ?)');
    params.push(...Array(4).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const [agg] = await query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN b.status <> 'cancelled' THEN b.net_amount END), 0) AS net_total,
            COALESCE(SUM(CASE WHEN b.status <> 'cancelled' THEN b.paid_amount END), 0) AS paid_total
       FROM bills b JOIN patients p ON p.id = b.patient_id WHERE ${w}`,
    params,
  );
  const rows = await query(
    `SELECT b.id, b.bill_no, b.bill_date, b.net_amount, b.paid_amount, b.payment_mode, b.status,
            p.patient_code, p.name AS patient_name, p.mobile
       FROM bills b JOIN patients p ON p.id = b.patient_id WHERE ${w} ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ rows, total: agg.total, net_total: agg.net_total, paid_total: agg.paid_total, page, limit, from, to });
});

router.get('/:id', requirePermission('bill.view', 'bill.create'), async (req, res) => {
  const bill = await loadBill(req.clinicId, toId(req.params.id));
  if (!bill) throw notFound('Bill');
  res.json(bill);
});

// POST /api/bills/:id/cancel – Admin only. Frees the pharmacy issues so they can be billed again.
router.post('/:id/cancel', requirePermission('bill.cancel'), async (req, res) => {
  const id = toId(req.params.id);
  await tx(async (q) => {
    const [bill] = await q('SELECT status FROM bills WHERE id = ? AND clinic_id = ? FOR UPDATE', [id, req.clinicId]);
    if (!bill) throw notFound('Bill');
    if (bill.status === 'cancelled') throw conflict('Bill already cancelled');
    await q("UPDATE bills SET status = 'cancelled', notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?",
      [` [Cancelled by ${req.user.name}${req.body?.reason ? ': ' + String(req.body.reason).slice(0, 120) : ''}]`, id]);
    await q("UPDATE pharmacy_issues SET status = 'issued', bill_id = NULL WHERE bill_id = ?", [id]);
  });
  res.json(await loadBill(req.clinicId, id));
});

export default router;
