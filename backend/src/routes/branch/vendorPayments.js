// Pharmacy → Vendor → Payments: money paid to a vendor against one of its Stock Ins (the supplier's bill).
// A bill's amount is worked out the same way as the Vendor Payments report:
//   Bill = Σ paid qty × Cur.Rate (+ GST % of the order line); Returned = Σ returned amount (+ GST);
//   Balance = Bill − Returned − Paid. A payment cannot be more than the balance.
// Only an Admin may delete a payment.
import { Router } from '../../lib/mini-express.js';
import { query, tx, insertRow, pageSql } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest, forbidden, notFound, paging, toAmount, toId, like } from '../../utils/http.js';
import { isISODate, todayISO } from '../../utils/dates.js';
import { nextSequence, formatVendorPaymentNo } from '../../utils/codes.js';
import { isAdmin } from '../../utils/stock.js';

const router = Router();
router.use(clinicScope(), requirePermission('vendor.pay'));

export const PAY_MODES = ['cash', 'upi', 'card', 'cheque', 'neft', 'other'];
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** SQL: one row per Stock In of the clinic with its bill, returned and paid amounts (filter with WHERE si.…). */
const INVOICES = `
  SELECT si.id AS stock_in_id, si.si_no, si.si_date, si.bill_no, si.supplier_id, s.name AS supplier_name, po.po_no,
         COALESCE(b.bill, 0) AS bill_amount, COALESCE(r.returned, 0) AS returned_amount, COALESCE(p.paid, 0) AS paid_amount
    FROM stock_ins si
    JOIN suppliers s ON s.id = si.supplier_id
    JOIN purchase_orders po ON po.id = si.po_id
    OUTER APPLY (SELECT SUM(ROUND(l.qty * l.rate, 2) + ROUND(l.qty * l.rate * COALESCE(pl.gst_percent, 0) / 100, 2)) AS bill
                   FROM stock_in_items l LEFT JOIN purchase_order_items pl ON pl.id = l.po_item_id
                  WHERE l.stock_in_id = si.id) b
    OUTER APPLY (SELECT SUM(ri.amount + ROUND(ri.amount * COALESCE(pl.gst_percent, 0) / 100, 2)) AS returned
                   FROM purchase_returns pr JOIN purchase_return_items ri ON ri.return_id = pr.id
                   JOIN stock_in_items l ON l.id = ri.stock_in_item_id LEFT JOIN purchase_order_items pl ON pl.id = l.po_item_id
                  WHERE pr.stock_in_id = si.id) r
    OUTER APPLY (SELECT SUM(vp.amount) AS paid FROM vendor_payments vp WHERE vp.stock_in_id = si.id) p`;

const withBalance = (r) => {
  const bill = r2(r.bill_amount);
  const returned = r2(r.returned_amount);
  const paid = r2(r.paid_amount);
  return { ...r, bill_amount: bill, returned_amount: returned, paid_amount: paid, balance: r2(bill - returned - paid) };
};

// GET /api/vendor-payments/invoices?supplier_id=&open=1 – the vendor's Stock Ins (bills) with what is still due
router.get('/invoices', async (req, res) => {
  const supplierId = toId(req.query.supplier_id, 'vendor');
  const rows = (await query(`${INVOICES} WHERE si.clinic_id = ? AND si.supplier_id = ? ORDER BY si.si_date DESC, si.id DESC`,
    [req.clinicId, supplierId])).map(withBalance);
  res.json({ rows: req.query.open === '1' ? rows.filter((r) => r.balance > 0) : rows });
});

// GET /api/vendor-payments/invoices/:stockInId – one bill with its payments (newest first)
router.get('/invoices/:stockInId', async (req, res) => {
  const id = toId(req.params.stockInId, 'Stock In');
  const [row] = await query(`${INVOICES} WHERE si.clinic_id = ? AND si.id = ?`, [req.clinicId, id]);
  if (!row) throw notFound('Stock In');
  const payments = await query('SELECT * FROM vendor_payments WHERE stock_in_id = ? ORDER BY pay_date DESC, id DESC', [id]);
  res.json({ ...withBalance(row), payments });
});

// GET /api/vendor-payments?q=&supplier_id=&from=&to=&page= – every payment, newest first, with the total paid
router.get('/', async (req, res) => {
  const { limit, offset, page } = paging(req.query, { maxLimit: 100 });
  const where = ['vp.clinic_id = ?'];
  const params = [req.clinicId];
  if (req.query.supplier_id) { where.push('vp.supplier_id = ?'); params.push(toId(req.query.supplier_id, 'vendor')); }
  if (isISODate(req.query.from)) { where.push('vp.pay_date >= ?'); params.push(req.query.from); }
  if (isISODate(req.query.to)) { where.push('vp.pay_date <= ?'); params.push(req.query.to); }
  if (req.query.q) {
    where.push('(vp.payment_no LIKE ? OR vp.reference_no LIKE ? OR si.si_no LIKE ? OR si.bill_no LIKE ? OR s.name LIKE ?)');
    params.push(...Array(5).fill(like(req.query.q)));
  }
  const w = where.join(' AND ');
  const from = 'FROM vendor_payments vp JOIN suppliers s ON s.id = vp.supplier_id JOIN stock_ins si ON si.id = vp.stock_in_id';
  const [{ total, amount }] = await query(`SELECT COUNT(*) AS total, SUM(vp.amount) AS amount ${from} WHERE ${w}`, params);
  const rows = await query(
    `SELECT vp.id, vp.payment_no, vp.pay_date, vp.amount, vp.pay_mode, vp.reference_no, vp.notes,
            vp.supplier_id, s.name AS supplier_name, vp.stock_in_id, si.si_no, si.bill_no
       ${from} WHERE ${w} ORDER BY vp.pay_date DESC, vp.id DESC ${pageSql}`,
    [...params, offset, limit],
  );
  res.json({ rows, total, page, limit, amount: r2(amount) });
});

// POST /api/vendor-payments { supplier_id, stock_in_id, pay_date, amount, pay_mode, reference_no, notes }
router.post('/', async (req, res) => {
  const b = req.body || {};
  const supplierId = toId(b.supplier_id, 'vendor');
  const siId = toId(b.stock_in_id, 'Stock In');
  const payDate = b.pay_date || todayISO();
  if (!isISODate(payDate)) throw badRequest('Invalid date', 'VALIDATION');
  if (payDate > todayISO()) throw badRequest('Payment date cannot be in the future', 'VALIDATION');
  const amount = toAmount(b.amount, 'amount');
  if (amount <= 0) throw badRequest('Enter the amount paid', 'VALIDATION');
  const mode = String(b.pay_mode || 'cash').toLowerCase();
  if (!PAY_MODES.includes(mode)) throw badRequest('Choose the payment mode', 'VALIDATION');
  const refNo = String(b.reference_no ?? '').trim().slice(0, 50) || null;
  if (['cheque', 'neft', 'upi'].includes(mode) && !refNo) throw badRequest('Enter the Cheque / Transaction No', 'VALIDATION');
  const notes = String(b.notes ?? '').trim().slice(0, 300) || null;

  const id = await tx(async (q) => {
    // one payment at a time per clinic, so two people can't both pay the last of a bill
    await q(`EXEC sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000`,
      [`vendor-pay-${req.clinicId}`]);
    const [row] = await q(`${INVOICES} WHERE si.clinic_id = ? AND si.id = ?`, [req.clinicId, siId]);
    if (!row) throw badRequest('Choose a Stock In', 'VALIDATION');
    if (row.supplier_id !== supplierId) throw badRequest('That Stock In is from another vendor', 'VALIDATION');
    if (payDate < String(row.si_date).slice(0, 10)) throw badRequest('Payment date cannot be before the Stock In date', 'VALIDATION');
    const { balance } = withBalance(row);
    if (amount > balance) throw badRequest(`Only ${balance.toFixed(2)} is due on ${row.si_no}`, 'VALIDATION');
    const [clinic] = await q('SELECT code FROM clinics WHERE id = ?', [req.clinicId]);
    const no = formatVendorPaymentNo(clinic.code, await nextSequence(q, req.clinicId, 'vendor_payment'));
    return insertRow(q, 'vendor_payments', {
      clinic_id: req.clinicId, payment_no: no, supplier_id: supplierId, stock_in_id: siId, pay_date: payDate,
      amount, pay_mode: mode, reference_no: refNo, notes, created_by: req.user.id,
    });
  });
  const [saved] = await query('SELECT * FROM vendor_payments WHERE id = ?', [id]);
  res.status(201).json(saved);
});

// DELETE /api/vendor-payments/:id – Admin only
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Only an Admin can delete a payment');
  const r = await query('DELETE FROM vendor_payments WHERE id = ? AND clinic_id = ?', [toId(req.params.id), req.clinicId]);
  if (!r.affectedRows) throw notFound('Payment');
  res.json({ ok: true });
});

export default router;
