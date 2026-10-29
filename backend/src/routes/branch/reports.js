// Pharmacy → Report → Vendor Payments: what is owed to each vendor, from Stock Ins less Returns.
// Amounts are at the purchase Cur.Rate plus the GST % of the purchase order line:
//   Stock In = Σ qty × rate (+ GST); Return = Σ returned qty × rate (+ GST); Net Payable = Stock In − Return.
// from / to (optional, YYYY-MM-DD) limit by the Stock In / Return date.
import { Router } from '../../lib/mini-express.js';
import { query } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { toId } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** SQL date limits for column `col` from ?from=&to= */
function dateRange(req, col) {
  const parts = [];
  const params = [];
  if (isISODate(req.query.from)) { parts.push(`${col} >= ?`); params.push(req.query.from); }
  if (isISODate(req.query.to)) { parts.push(`${col} <= ?`); params.push(req.query.to); }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

// Stock In lines with their GST % (from the purchase order line)
const STOCK_IN = `FROM stock_ins si JOIN stock_in_items l ON l.stock_in_id = si.id
  LEFT JOIN purchase_order_items p ON p.id = l.po_item_id
  CROSS APPLY (SELECT ROUND(l.qty * l.rate, 2) AS taxable, ROUND(l.qty * l.rate * COALESCE(p.gst_percent, 0) / 100, 2) AS gst) a`;
// Return lines with the GST % of the Stock In line they came from
const RETURN = `FROM purchase_returns r JOIN purchase_return_items ri ON ri.return_id = r.id
  JOIN stock_in_items l ON l.id = ri.stock_in_item_id LEFT JOIN purchase_order_items p ON p.id = l.po_item_id
  CROSS APPLY (SELECT ri.amount AS taxable, ROUND(ri.amount * COALESCE(p.gst_percent, 0) / 100, 2) AS gst) a`;

const totals = (x) => {
  const taxable = r2(x?.taxable);
  const gst = r2(x?.gst);
  return { taxable, gst, total: r2(taxable + gst) };
};

// GET /api/reports/vendor-payments?from=&to= – one row per vendor with any Stock In or Return
router.get('/vendor-payments', async (req, res) => {
  const siDates = dateRange(req, 'si.si_date');
  const rtDates = dateRange(req, 'r.return_date');
  const stockIn = await query(
    `SELECT si.supplier_id, COUNT(DISTINCT si.id) AS entries, SUM(a.taxable) AS taxable, SUM(a.gst) AS gst
       ${STOCK_IN} WHERE si.clinic_id = ?${siDates.sql} GROUP BY si.supplier_id`,
    [req.clinicId, ...siDates.params],
  );
  const returned = await query(
    `SELECT r.supplier_id, COUNT(DISTINCT r.id) AS entries, SUM(a.taxable) AS taxable, SUM(a.gst) AS gst
       ${RETURN} WHERE r.clinic_id = ?${rtDates.sql} GROUP BY r.supplier_id`,
    [req.clinicId, ...rtDates.params],
  );
  const ids = [...new Set([...stockIn, ...returned].map((x) => x.supplier_id))];
  const vendors = ids.length
    ? await query(`SELECT id, name, mobile FROM suppliers WHERE clinic_id = ? AND id IN (${ids.map(() => '?').join(', ')})`, [req.clinicId, ...ids])
    : [];
  const rows = vendors.map((v) => {
    const si = stockIn.find((x) => x.supplier_id === v.id);
    const rt = returned.find((x) => x.supplier_id === v.id);
    const a = totals(si);
    const b = totals(rt);
    return {
      supplier_id: v.id, supplier_name: v.name, mobile: v.mobile,
      stock_in_count: si?.entries || 0, stock_in: a, return_count: rt?.entries || 0, returned: b,
      payable: r2(a.total - b.total),
    };
  }).sort((x, y) => x.supplier_name.localeCompare(y.supplier_name));
  const sum = (f) => r2(rows.reduce((s, r) => s + f(r), 0));
  res.json({
    rows,
    totals: {
      stock_in_count: rows.reduce((s, r) => s + r.stock_in_count, 0), return_count: rows.reduce((s, r) => s + r.return_count, 0),
      stock_in: { taxable: sum((r) => r.stock_in.taxable), gst: sum((r) => r.stock_in.gst), total: sum((r) => r.stock_in.total) },
      returned: { taxable: sum((r) => r.returned.taxable), gst: sum((r) => r.returned.gst), total: sum((r) => r.returned.total) },
      payable: sum((r) => r.payable),
    },
  });
});

// GET /api/reports/vendor-payments/:supplierId?from=&to= – the vendor's Stock Ins and Returns (with their item
// names), newest first
router.get('/vendor-payments/:supplierId', async (req, res) => {
  const supplierId = toId(req.params.supplierId, 'vendor');
  const siDates = dateRange(req, 'si.si_date');
  const rtDates = dateRange(req, 'r.return_date');
  const stockIns = await query(
    `SELECT si.id, si.si_no AS doc_no, si.si_date AS doc_date, po.po_no AS ref_no, COUNT(*) AS items, SUM(l.qty) AS qty,
            STRING_AGG(l.item_name, ', ') WITHIN GROUP (ORDER BY l.id) AS item_names,
            SUM(a.taxable) AS taxable, SUM(a.gst) AS gst
       ${STOCK_IN} JOIN purchase_orders po ON po.id = si.po_id
      WHERE si.clinic_id = ? AND si.supplier_id = ?${siDates.sql}
      GROUP BY si.id, si.si_no, si.si_date, po.po_no`,
    [req.clinicId, supplierId, ...siDates.params],
  );
  const returns = await query(
    `SELECT r.id, r.return_no AS doc_no, r.return_date AS doc_date, s2.si_no AS ref_no, COUNT(*) AS items, SUM(ri.qty) AS qty,
            STRING_AGG(ri.item_name, ', ') WITHIN GROUP (ORDER BY ri.id) AS item_names,
            SUM(a.taxable) AS taxable, SUM(a.gst) AS gst
       ${RETURN} JOIN stock_ins s2 ON s2.id = r.stock_in_id
      WHERE r.clinic_id = ? AND r.supplier_id = ?${rtDates.sql}
      GROUP BY r.id, r.return_no, r.return_date, s2.si_no`,
    [req.clinicId, supplierId, ...rtDates.params],
  );
  const rows = [
    ...stockIns.map((x) => ({ ...x, type: 'stock_in', ...totals(x) })),
    ...returns.map((x) => ({ ...x, type: 'return', ...totals(x) })),
  ].sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date)) || String(b.doc_no).localeCompare(String(a.doc_no)));
  res.json({ rows });
});

export default router;
