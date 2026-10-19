// Pharmacy dispensing: issue prescribed items to the patient and reduce stock.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, toAmount, toId } from '../../utils/http.js';
import { addDays, isISODate, todayISO } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope(), requirePermission('dispense'));

const round2 = (n) => Math.round(n * 100) / 100;

// GET /api/dispense/pending?date= – visits of the day with prescription lines not fully issued
router.get('/pending', async (req, res) => {
  const day = isISODate(req.query.date) ? req.query.date : todayISO();
  const rows = await query(
    `SELECT v.id AS visit_id, v.visit_date, v.status AS visit_status, p.id AS patient_id, p.patient_code, p.name AS patient_name,
            p.mobile, q.token_no, d.name AS doctor_name, rx.rx_lines, rx.pending_lines
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN (SELECT visit_id, COUNT(*) AS rx_lines,
                    SUM(CASE WHEN item_id IS NOT NULL AND issued_qty < quantity THEN 1 ELSE 0 END) AS pending_lines
               FROM prescriptions GROUP BY visit_id) rx ON rx.visit_id = v.id
       LEFT JOIN queue_entries q ON q.id = v.queue_id
       LEFT JOIN employees d ON d.id = v.doctor_id
      WHERE v.clinic_id = ? AND v.visit_date >= ? AND v.visit_date < ?
      ORDER BY CASE WHEN rx.pending_lines = 0 THEN 1 ELSE 0 END, q.token_no, v.id`,
    [req.clinicId, day, addDays(day, 1)],
  );
  res.json({ date: day, rows });
});

// GET /api/dispense/visit/:visitId – prescription lines with stock, price, already issued
router.get('/visit/:visitId', async (req, res) => {
  const visitId = toId(req.params.visitId, 'visit');
  const [visit] = await query(
    `SELECT v.id, v.visit_date, v.status, p.id AS patient_id, p.patient_code, p.name AS patient_name, p.mobile, q.token_no
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN queue_entries q ON q.id = v.queue_id
      WHERE v.id = ? AND v.clinic_id = ?`,
    [visitId, req.clinicId],
  );
  if (!visit) throw notFound('Visit');
  visit.lines = await query(
    `SELECT rx.id AS prescription_id, rx.medicine_name, rx.potency, rx.dosage, rx.frequency, rx.duration, rx.quantity, rx.issued_qty,
            rx.item_id, i.name AS item_name, i.unit, i.price, i.gst_percent, i.stock_qty
       FROM prescriptions rx LEFT JOIN items i ON i.id = rx.item_id
      WHERE rx.visit_id = ? AND rx.clinic_id = ? ORDER BY rx.sort_order, rx.id`,
    [visitId, req.clinicId],
  );
  visit.issues = await query(
    `SELECT pi.id, pi.issued_at, pi.items_total, pi.status, pi.bill_id, e.name AS issued_by_name
       FROM pharmacy_issues pi LEFT JOIN employees e ON e.id = pi.issued_by
      WHERE pi.visit_id = ? AND pi.clinic_id = ? ORDER BY pi.id`,
    [visitId, req.clinicId],
  );
  res.json(visit);
});

// POST /api/dispense/visit/:visitId  { lines: [{ prescription_id?, item_id, qty }] }
// Locks every item row, checks stock, deducts it, writes the stock ledger.
router.post('/visit/:visitId', async (req, res) => {
  const visitId = toId(req.params.visitId, 'visit');
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.filter((l) => Number(l.qty) > 0) : [];
  if (!lines.length) throw badRequest('Select at least one item with quantity', 'VALIDATION');

  const issueId = await tx(async (q) => {
    const [visit] = await q('SELECT id, patient_id FROM visits WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [visitId, req.clinicId]);
    if (!visit) throw notFound('Visit');

    // Lock items in id order to avoid deadlocks between two pharmacists
    const itemIds = [...new Set(lines.map((l) => toId(l.item_id, 'item')))].sort((a, b) => a - b);
    const items = await q('SELECT id, name, price, gst_percent, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id IN (?) AND clinic_id = ?', [itemIds, req.clinicId]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const need = new Map();
    for (const l of lines) {
      const id = Number(l.item_id);
      if (!byId.has(id)) throw badRequest('Item not found in this clinic', 'VALIDATION');
      need.set(id, round2((need.get(id) || 0) + toAmount(l.qty, 'qty')));
    }
    for (const [id, qty] of need) {
      const it = byId.get(id);
      if (Number(it.stock_qty) < qty) throw badRequest(`Not enough stock for ${it.name} (available ${it.stock_qty})`, 'OUT_OF_STOCK');
    }

    const newIssueId = await insertRow(q, 'pharmacy_issues', {
      clinic_id: req.clinicId, visit_id: visitId, patient_id: visit.patient_id, issued_by: req.user.id,
    });
    let total = 0;
    for (const l of lines) {
      const it = byId.get(Number(l.item_id));
      const qty = toAmount(l.qty, 'qty');
      const amount = round2(qty * Number(it.price));
      total += amount;
      let rxId = null;
      if (l.prescription_id) {
        const [rx] = await q('SELECT id FROM prescriptions WHERE id = ? AND visit_id = ?', [toId(l.prescription_id, 'prescription'), visitId]);
        if (rx) {
          rxId = rx.id;
          await q('UPDATE prescriptions SET issued_qty = issued_qty + ?, item_id = COALESCE(item_id, ?) WHERE id = ?', [qty, it.id, rxId]);
        }
      }
      await insertRow(q, 'pharmacy_issue_items', {
        clinic_id: req.clinicId, issue_id: newIssueId, prescription_id: rxId, item_id: it.id,
        qty, rate: it.price, gst_percent: it.gst_percent, amount,
      });
      it.stock_qty = round2(Number(it.stock_qty) - qty);
      await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [it.stock_qty, it.id]);
      await insertRow(q, 'stock_movements', {
        clinic_id: req.clinicId, item_id: it.id, qty_change: -qty, balance_after: it.stock_qty,
        reason: 'issue', ref_type: 'pharmacy_issue', ref_id: newIssueId, created_by: req.user.id,
      });
    }
    await q('UPDATE pharmacy_issues SET items_total = ? WHERE id = ?', [round2(total), newIssueId]);
    return newIssueId;
  });

  const [issue] = await query('SELECT * FROM pharmacy_issues WHERE id = ?', [issueId]);
  issue.items = await query(
    'SELECT pii.*, i.name AS item_name, i.unit FROM pharmacy_issue_items pii JOIN items i ON i.id = pii.item_id WHERE pii.issue_id = ?',
    [issueId],
  );
  res.status(201).json(issue);
});

export default router;
