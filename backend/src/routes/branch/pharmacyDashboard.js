// Pharmacy → Dashboard: the pharmacy's day at a glance, for the active clinic.
//   Sales today / this month (net of Sales Returns), Stock In today / this month (at Cur.Rate + GST),
//   items at or below their reorder level, items out of stock, batches expiring in the next 90 days
//   or already expired with stock left, what is still owed to vendors, and the last 7 days of sales.
import { Router } from '../../lib/mini-express.js';
import { query } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { todayISO } from '../../utils/dates.js';
import { batchLeftSql } from '../../utils/stock.js';

const router = Router();
router.use(clinicScope(), requirePermission('item.view', 'dispense', 'stock.manage'));

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

router.get('/', async (req, res) => {
  const c = req.clinicId;
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = addDays(today, -6);
  const soon = addDays(today, 90);

  const [sales] = await query(
    `SELECT SUM(CASE WHEN sale_date = ? THEN 1 ELSE 0 END) AS today_count,
            SUM(CASE WHEN sale_date = ? THEN total_amount ELSE 0 END) AS today_amount,
            SUM(CASE WHEN sale_date >= ? THEN 1 ELSE 0 END) AS month_count,
            SUM(CASE WHEN sale_date >= ? THEN total_amount ELSE 0 END) AS month_amount
       FROM sales WHERE clinic_id = ? AND sale_date >= ?`,
    [today, today, monthStart, monthStart, c, monthStart < weekStart ? monthStart : weekStart],
  );
  const [returns] = await query(
    `SELECT SUM(CASE WHEN return_date = ? THEN total_amount ELSE 0 END) AS today_amount,
            SUM(total_amount) AS month_amount
       FROM sales_returns WHERE clinic_id = ? AND return_date >= ?`,
    [today, c, monthStart],
  );
  const [purchases] = await query(
    `SELECT SUM(CASE WHEN si.si_date = ? THEN a.total ELSE 0 END) AS today_amount, SUM(a.total) AS month_amount,
            COUNT(DISTINCT CASE WHEN si.si_date = ? THEN si.id END) AS today_count
       FROM stock_ins si JOIN stock_in_items l ON l.stock_in_id = si.id
       LEFT JOIN purchase_order_items p ON p.id = l.po_item_id
       CROSS APPLY (SELECT ROUND(l.qty * l.rate, 2) + ROUND(l.qty * l.rate * COALESCE(p.gst_percent, 0) / 100, 2) AS total) a
      WHERE si.clinic_id = ? AND si.si_date >= ?`,
    [today, today, c, monthStart],
  );
  const [stock] = await query(
    `SELECT SUM(CASE WHEN reorder_level > 0 AND stock_qty <= reorder_level AND stock_qty > 0 THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) AS out_count,
            COUNT(*) AS item_count,
            SUM(ROUND(stock_qty * price, 2)) AS stock_value
       FROM items WHERE clinic_id = ? AND status = N'active'`,
    [c],
  );
  const lowItems = await query(
    `SELECT TOP 10 id, name, unit, stock_qty, reorder_level FROM items
      WHERE clinic_id = ? AND status = N'active' AND reorder_level > 0 AND stock_qty <= reorder_level
      ORDER BY stock_qty / NULLIF(reorder_level, 0), name`,
    [c],
  );
  const batches = await query(
    `SELECT x.* FROM (
       SELECT l.id, l.item_name, l.batch_no, l.exp_date, ${batchLeftSql('l')} AS left_qty
         FROM stock_in_items l WHERE l.clinic_id = ? AND l.exp_date IS NOT NULL AND l.exp_date <= ?
     ) x WHERE x.left_qty > 0 ORDER BY x.exp_date, x.item_name`,
    [0, 0, 0, c, soon],
  );
  const expired = batches.filter((b) => String(b.exp_date).slice(0, 10) < today);
  const expiring = batches.filter((b) => String(b.exp_date).slice(0, 10) >= today);
  const [dues] = await query(
    `SELECT SUM(b.bill) - COALESCE(SUM(r.returned), 0) - COALESCE(SUM(p.paid), 0) AS balance
       FROM stock_ins si
       OUTER APPLY (SELECT SUM(ROUND(l.qty * l.rate, 2) + ROUND(l.qty * l.rate * COALESCE(pl.gst_percent, 0) / 100, 2)) AS bill
                      FROM stock_in_items l LEFT JOIN purchase_order_items pl ON pl.id = l.po_item_id WHERE l.stock_in_id = si.id) b
       OUTER APPLY (SELECT SUM(ri.amount + ROUND(ri.amount * COALESCE(pl.gst_percent, 0) / 100, 2)) AS returned
                      FROM purchase_returns pr JOIN purchase_return_items ri ON ri.return_id = pr.id
                      JOIN stock_in_items l ON l.id = ri.stock_in_item_id LEFT JOIN purchase_order_items pl ON pl.id = l.po_item_id
                     WHERE pr.stock_in_id = si.id) r
       OUTER APPLY (SELECT SUM(vp.amount) AS paid FROM vendor_payments vp WHERE vp.stock_in_id = si.id) p
      WHERE si.clinic_id = ?`,
    [c],
  );
  const days = await query(
    `SELECT sale_date, COUNT(*) AS bills, SUM(total_amount) AS amount FROM sales
      WHERE clinic_id = ? AND sale_date >= ? GROUP BY sale_date`,
    [c, weekStart],
  );
  const byDay = new Map(days.map((d) => [String(d.sale_date).slice(0, 10), d]));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    return { date: d, bills: byDay.get(d)?.bills || 0, amount: r2(byDay.get(d)?.amount) };
  });
  const recent = await query(
    `SELECT TOP 6 id, sale_no, sale_date, customer_name, total_amount FROM sales WHERE clinic_id = ? ORDER BY id DESC`, [c],
  );

  res.json({
    today,
    sales: {
      today_count: sales.today_count || 0, today_amount: r2(sales.today_amount), today_returns: r2(returns.today_amount),
      month_count: sales.month_count || 0, month_amount: r2(sales.month_amount), month_returns: r2(returns.month_amount),
    },
    purchases: { today_count: purchases.today_count || 0, today_amount: r2(purchases.today_amount), month_amount: r2(purchases.month_amount) },
    stock: { item_count: stock.item_count || 0, low_count: stock.low_count || 0, out_count: stock.out_count || 0, stock_value: r2(stock.stock_value) },
    vendor_dues: r2(dues.balance),
    low_items: lowItems,
    expiring: { count: expiring.length, rows: expiring.slice(0, 10) },
    expired: { count: expired.length, rows: expired.slice(0, 10) },
    week,
    recent,
  });
});

export default router;
