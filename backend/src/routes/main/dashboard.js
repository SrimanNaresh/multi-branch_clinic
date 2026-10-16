import { Router } from '../../lib/mini-express.js';
import { query } from '../../config/db.js';
import { requirePermission } from '../../middleware/access.js';
import { addDays, isISODate, monthStartISO, todayISO } from '../../utils/dates.js';

const router = Router();

// GET /api/dashboard/summary?date=YYYY-MM-DD
// Per-branch figures + grand totals for the Main Clinic dashboard.
router.get('/summary', requirePermission('dashboard.view'), async (req, res) => {
  const day = isISODate(req.query.date) ? req.query.date : todayISO();
  const next = addDays(day, 1);
  const monthStart = monthStartISO(day);

  const clinics = await query(
    `SELECT c.id, c.name, c.code, c.city, c.status,
       (SELECT COUNT(*) FROM patients p WHERE p.clinic_id = c.id) AS patients_total,
       (SELECT COUNT(*) FROM patients p WHERE p.clinic_id = c.id AND p.created_at >= ? AND p.created_at < ?) AS patients_new_today,
       (SELECT COUNT(*) FROM queue_entries q WHERE q.clinic_id = c.id AND q.queue_date = ? AND q.status <> 'cancelled') AS queue_total,
       (SELECT COUNT(*) FROM queue_entries q WHERE q.clinic_id = c.id AND q.queue_date = ? AND q.status = 'waiting') AS queue_waiting,
       (SELECT COUNT(*) FROM queue_entries q WHERE q.clinic_id = c.id AND q.queue_date = ? AND q.status = 'with_doctor') AS queue_with_doctor,
       (SELECT COUNT(*) FROM queue_entries q WHERE q.clinic_id = c.id AND q.queue_date = ? AND q.status = 'done') AS queue_done,
       (SELECT COALESCE(SUM(b.net_amount), 0) FROM bills b WHERE b.clinic_id = c.id AND b.status <> 'cancelled' AND b.bill_date >= ? AND b.bill_date < ?) AS billing_today,
       (SELECT COUNT(*) FROM bills b WHERE b.clinic_id = c.id AND b.status <> 'cancelled' AND b.bill_date >= ? AND b.bill_date < ?) AS bills_today,
       (SELECT COALESCE(SUM(b.net_amount), 0) FROM bills b WHERE b.clinic_id = c.id AND b.status <> 'cancelled' AND b.bill_date >= ? AND b.bill_date < ?) AS billing_month,
       (SELECT COUNT(*) FROM employees e WHERE e.clinic_id = c.id AND e.status = 'active') AS employees,
       (SELECT COUNT(*) FROM pharmacies ph WHERE ph.clinic_id = c.id) AS pharmacies,
       (SELECT COUNT(*) FROM labs l WHERE l.clinic_id = c.id) AS labs,
       (SELECT COUNT(*) FROM items i WHERE i.clinic_id = c.id AND i.status = 'active' AND i.stock_qty <= i.reorder_level) AS low_stock_items
     FROM clinics c
     ORDER BY c.status = 'active' DESC, c.name`,
    [day, next, day, day, day, day, day, next, day, next, monthStart, next],
  );

  const sumKeys = ['patients_total', 'patients_new_today', 'queue_total', 'queue_waiting', 'queue_with_doctor', 'queue_done',
    'billing_today', 'bills_today', 'billing_month', 'employees', 'pharmacies', 'labs', 'low_stock_items'];
  const totals = Object.fromEntries(sumKeys.map((k) => [k, 0]));
  for (const c of clinics) for (const k of sumKeys) totals[k] += Number(c[k]) || 0;
  totals.billing_today = Math.round(totals.billing_today * 100) / 100;
  totals.billing_month = Math.round(totals.billing_month * 100) / 100;
  totals.clinics_active = clinics.filter((c) => c.status === 'active').length;
  totals.clinics_total = clinics.length;

  res.json({ date: day, totals, clinics });
});

export default router;
