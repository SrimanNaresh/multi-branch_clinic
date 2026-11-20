// Pharmacy → Report → All in One: pick a screen, then the columns to show (as in Ayush All In One).
// Each screen lists its columns here as SQL expressions, so only these can be asked for. A screen with item
// lines has `lines`: picking any line column gives one row per line (the document's columns repeat on each);
// otherwise one row per document. Every screen is limited to the active clinic. At most 5000 rows.
import { Router } from '../../lib/mini-express.js';
import { query } from '../../config/db.js';
import { clinicScope, requirePermission } from '../../middleware/access.js';
import { badRequest } from '../../utils/http.js';
import { isISODate } from '../../utils/dates.js';

const router = Router();
router.use(clinicScope(), requirePermission('stock.manage'));

const MAX_ROWS = 5000;
const SCHEDULE = "CASE WHEN i.schedule_h1 = 1 THEN 'H1' WHEN i.schedule_h = 1 THEN 'H' ELSE 'None' END";

// Column: [key, label, sql, type]; type: text (default) | date | qty | money | percent.
const SCREENS = {
  item: {
    label: 'Item', from: 'items i', clinic: 'i.clinic_id', order: 'i.name',
    filters: ['category', 'unit', 'manufacturer', 'generic', 'potency', 'schedule', 'status'],
    columns: [
      ['itemCode', 'Item Code', 'i.item_code'], ['itemName', 'Item Name', 'i.name'], ['generic', 'Generic Name', 'i.generic_name'],
      ['manufacturer', 'Manufacturer', 'i.manufacturer'], ['category', 'Category', 'i.category'], ['potency', 'Potency', 'i.potency'],
      ['unit', 'Type / Unit', 'i.unit'], ['pack', 'Pack', 'i.pack'], ['hsn', 'HSN', 'i.hsn_code'], ['rack', 'Rack', 'i.rack'], ['box', 'Box', 'i.box'],
      ['mrp', 'MRP', 'i.mrp', 'money'], ['purchaseRate', 'Purchase Rate', 'i.purchase_rate', 'money'], ['sellPrice', 'Sell Price', 'i.price', 'money'],
      ['cgst', 'CGST %', 'i.cgst_percent', 'percent'], ['sgst', 'SGST %', 'i.sgst_percent', 'percent'], ['gst', 'GST %', 'i.gst_percent', 'percent'],
      ['schedule', 'Schedule', SCHEDULE], ['status', 'Status', 'i.status'], ['reorder', 'Reorder Level', 'i.reorder_level', 'qty'],
      ['stock', 'Current Stock', 'i.stock_qty', 'qty'], ['stockValue', 'Stock Value', 'ROUND(i.stock_qty * i.price, 2)', 'money'],
    ],
  },
  vendor: {
    label: 'Vendor', from: 'suppliers v', clinic: 'v.clinic_id', order: 'v.name', filters: ['state', 'status'],
    columns: [
      ['vendorName', 'Vendor Name', 'v.name'], ['contact', 'Contact Person', 'v.contact_person'], ['mobile', 'Mobile', 'v.mobile'],
      ['phone', 'Phone', 'v.phone'], ['email', 'Email', 'v.email'], ['address', 'Address', 'v.address'], ['state', 'State', 'v.state'],
      ['pincode', 'Pin Code', 'v.pincode'], ['gstin', 'GSTIN', 'v.gstin'], ['dl1', 'DL No 1', 'v.dl_no1'], ['dl2', 'DL No 2', 'v.dl_no2'],
      ['status', 'Status', 'v.status'],
    ],
  },
  purchase: {
    label: 'Purchase / Order', from: 'purchase_orders h JOIN suppliers v ON v.id = h.supplier_id', clinic: 'h.clinic_id',
    date: 'h.po_date', order: 'h.po_date DESC, h.id DESC', filters: ['vendor', 'category', 'manufacturer'],
    columns: [
      ['orderNo', 'Order No', 'h.po_no'], ['orderDate', 'Order Date', 'h.po_date', 'date'], ['vendor', 'Vendor', 'v.name'],
      ['roundOff', 'Round Off', 'h.round_off', 'money'], ['orderTotal', 'Order Total', 'h.total_amount', 'money'],
    ],
    lines: {
      join: 'JOIN purchase_order_items l ON l.po_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['generic', 'Generic Name', 'l.generic_name'], ['manufacturer', 'Manufacturer', 'l.manufacturer'],
        ['category', 'Category', 'l.category'], ['hsn', 'HSN', 'l.hsn_code'], ['pack', 'Pack', 'l.pack'], ['unit', 'Unit', 'l.unit'],
        ['mrp', 'MRP', 'l.mrp', 'money'], ['pRate', 'P.Rate', 'l.p_rate', 'money'], ['disc', 'Disc %', 'l.disc_percent', 'percent'],
        ['rate', 'Rate', 'l.rate', 'money'], ['qty', 'Qty', 'l.qty', 'qty'], ['free', 'Free', 'l.free_qty', 'qty'],
        ['amount', 'Amount', 'l.amount', 'money'], ['gst', 'GST %', 'l.gst_percent', 'percent'], ['gstAmount', 'GST Amount', 'l.gst_amount', 'money'],
        ['total', 'Total', 'l.total', 'money'],
      ],
    },
  },
  stockIn: {
    label: 'Stock In',
    from: 'stock_ins h JOIN suppliers v ON v.id = h.supplier_id JOIN purchase_orders p ON p.id = h.po_id', clinic: 'h.clinic_id',
    date: 'h.si_date', order: 'h.si_date DESC, h.id DESC', filters: ['vendor'],
    columns: [
      ['stockInNo', 'Stock In No', 'h.si_no'], ['stockInDate', 'Date', 'h.si_date', 'date'], ['billNo', 'Bill No', 'h.bill_no'],
      ['vendor', 'Vendor', 'v.name'], ['orderNo', 'Order No', 'p.po_no'],
    ],
    lines: {
      join: 'JOIN stock_in_items l ON l.stock_in_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['batch', 'Batch No', 'l.batch_no'], ['mfg', 'Mf.Date', 'l.mfg_date', 'date'],
        ['exp', 'Exp.Date', 'l.exp_date', 'date'], ['qty', 'R.Order', 'l.qty', 'qty'], ['free', 'R.Free', 'l.free_qty', 'qty'],
        ['rate', 'Cur.Rate', 'l.rate', 'money'], ['mrp', 'MRP', 'l.mrp', 'money'], ['sDisc', 'S.Disc %', 'l.disc_percent', 'percent'],
        ['sel', 'Sel.Amount', 'l.sel_amount', 'money'], ['buyAmount', 'Buy Amount', 'ROUND(l.qty * l.rate, 2)', 'money'],
      ],
    },
  },
  purchaseReturn: {
    label: 'Purchase Return',
    from: 'purchase_returns h JOIN suppliers v ON v.id = h.supplier_id JOIN stock_ins s ON s.id = h.stock_in_id', clinic: 'h.clinic_id',
    date: 'h.return_date', order: 'h.return_date DESC, h.id DESC', filters: ['vendor'],
    columns: [
      ['returnNo', 'Return No', 'h.return_no'], ['returnDate', 'Date', 'h.return_date', 'date'], ['vendor', 'Vendor', 'v.name'],
      ['stockInNo', 'Stock In No', 's.si_no'], ['returnTotal', 'Return Total', 'h.total_amount', 'money'],
    ],
    lines: {
      join: 'JOIN purchase_return_items l ON l.return_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['batch', 'Batch No', 'l.batch_no'], ['exp', 'Exp.Date', 'l.exp_date', 'date'],
        ['qty', 'Qty', 'l.qty', 'qty'], ['rate', 'Rate', 'l.rate', 'money'], ['amount', 'Amount', 'l.amount', 'money'],
      ],
    },
  },
  sales: {
    label: 'Sales', from: 'sales h', clinic: 'h.clinic_id', date: 'h.sale_date', order: 'h.sale_date DESC, h.id DESC', filters: [],
    columns: [
      ['saleNo', 'Sale No', 'h.sale_no'], ['saleDate', 'Date', 'h.sale_date', 'date'], ['customer', 'Customer', 'h.customer_name'],
      ['mobile', 'Mobile', 'h.mobile'], ['subTotal', 'Sub Total', 'h.sub_total', 'money'], ['billDisc', 'Bill Disc %', 'h.disc_percent', 'percent'],
      ['discount', 'Discount', 'h.discount_amount', 'money'], ['roundOff', 'Round Off', 'h.round_off', 'money'], ['total', 'Total', 'h.total_amount', 'money'],
    ],
    lines: {
      join: 'JOIN sale_items l ON l.sale_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['batch', 'Batch No', 'l.batch_no'], ['exp', 'Exp.Date', 'l.exp_date', 'date'],
        ['sellBy', 'Sell by', 'l.sale_unit'], ['qty', 'Qty', 'COALESCE(l.unit_qty, l.qty)', 'qty'], ['packs', 'Packs', 'l.qty', 'qty'],
        ['price', 'Sale Price', 'l.price', 'money'], ['disc', 'Disc %', 'l.disc_percent', 'percent'], ['amount', 'Amount', 'l.amount', 'money'],
      ],
    },
  },
  salesReturn: {
    label: 'Sales Return', from: 'sales_returns h LEFT JOIN sales s ON s.id = h.sale_id', clinic: 'h.clinic_id', date: 'h.return_date',
    order: 'h.return_date DESC, h.id DESC', filters: [],
    columns: [
      ['returnNo', 'Return No', 'h.return_no'], ['returnDate', 'Date', 'h.return_date', 'date'], ['saleNo', 'Sale No', 's.sale_no'],
      ['customer', 'Customer', 'h.customer_name'], ['mobile', 'Mobile', 'h.mobile'], ['refund', 'Refund', 'h.total_amount', 'money'],
    ],
    lines: {
      join: 'JOIN sales_return_items l ON l.sales_return_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['batch', 'Batch No', 'l.batch_no'], ['sellBy', 'Sell by', 'l.sale_unit'],
        ['qty', 'Qty', 'l.unit_qty', 'qty'], ['price', 'Sale Price', 'l.price', 'money'], ['amount', 'Amount', 'l.amount', 'money'],
      ],
    },
  },
  adjustment: {
    label: 'Stock Adjustment', from: 'stock_adjustments h', clinic: 'h.clinic_id', date: 'h.adj_date', order: 'h.adj_date DESC, h.id DESC', filters: [],
    columns: [
      ['adjNo', 'Adjustment No', 'h.adj_no'], ['adjDate', 'Date', 'h.adj_date', 'date'], ['remarks', 'Remarks', 'h.remarks'],
      ['inTotal', 'In Total', 'h.in_total', 'money'], ['outTotal', 'Out Total', 'h.out_total', 'money'],
    ],
    lines: {
      join: 'JOIN stock_adjustment_items l ON l.adjustment_id = h.id', order: 'l.id',
      columns: [
        ['itemName', 'Item Name', 'l.item_name'], ['batch', 'Batch No', 'l.batch_no'], ['curStock', 'Cur. Stock', 'l.cur_stock', 'qty'],
        ['inQty', 'In Qty', 'l.in_qty', 'qty'], ['inPrice', 'In Price', 'l.in_price', 'money'], ['outQty', 'Out Qty', 'l.out_qty', 'qty'],
        ['outPrice', 'Out Price', 'l.out_price', 'money'],
      ],
    },
  },
  vendorPayment: {
    label: 'Vendor Payments',
    from: 'vendor_payments h JOIN suppliers v ON v.id = h.supplier_id JOIN stock_ins s ON s.id = h.stock_in_id', clinic: 'h.clinic_id',
    date: 'h.pay_date', order: 'h.pay_date DESC, h.id DESC', filters: ['vendor', 'mode'],
    columns: [
      ['paymentNo', 'Payment No', 'h.payment_no'], ['payDate', 'Date', 'h.pay_date', 'date'], ['vendor', 'Vendor', 'v.name'],
      ['stockInNo', 'Stock In No', 's.si_no'], ['billNo', 'Bill No', 's.bill_no'], ['mode', 'Mode', 'h.pay_mode'],
      ['refNo', 'Cheque / Txn No', 'h.reference_no'], ['amount', 'Amount', 'h.amount', 'money'], ['notes', 'Notes', 'h.notes'],
    ],
  },
};

const asColumn = (s, line) => ([key, label, , type = 'text']) => ({ key, label, type, line, filter: Boolean(s.filters?.includes(key)) });

function findColumn(s, key) {
  const l = s.lines?.columns.find((c) => c[0] === key);
  if (l) return { col: l, line: true };
  const h = s.columns.find((c) => c[0] === key);
  return h ? { col: h, line: false } : null;
}

// GET /api/all-in-one/screens – the screens and their columns (document columns first) for the pickers
router.get('/screens', (_req, res) => {
  res.json(Object.entries(SCREENS).map(([key, s]) => ({
    key, label: s.label, hasDate: Boolean(s.date),
    columns: [...s.columns.map(asColumn(s, false)), ...(s.lines?.columns || []).map(asColumn(s, true))],
  })));
});

// GET /api/all-in-one/values?screen=&column= – the values a filter column has in this clinic ('' = blank)
router.get('/values', async (req, res) => {
  const s = SCREENS[req.query.screen];
  const found = s && findColumn(s, String(req.query.column || ''));
  if (!found || !s.filters?.includes(found.col[0])) throw badRequest('Not a filter column', 'VALIDATION');
  const rows = await query(
    `SELECT DISTINCT TOP 1000 COALESCE(CAST(${found.col[2]} AS NVARCHAR(300)), '') AS v
       FROM ${s.from} ${found.line ? s.lines.join : ''} WHERE ${s.clinic} = ? ORDER BY v`, [req.clinicId],
  );
  res.json(rows.map((r) => r.v));
});

// GET /api/all-in-one?screen=&columns=a,b,c&from=&to=&filters={"key":["v1","v2"]}
//   → { grain: 'document' | 'line', columns: [...picked], rows, capped }
router.get('/', async (req, res) => {
  const s = SCREENS[req.query.screen];
  if (!s) throw badRequest('Pick a screen', 'VALIDATION');
  const wanted = String(req.query.columns || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!wanted.length) throw badRequest('Pick at least one column', 'VALIDATION');
  const picked = [];
  let byLine = false;
  for (const k of wanted) {
    const found = findColumn(s, k);
    if (!found) throw badRequest(`Unknown column "${k}"`, 'VALIDATION');
    if (!picked.some((p) => p.col === found.col)) picked.push(found);
    byLine ||= found.line;
  }
  let filters = {};
  try { filters = req.query.filters ? JSON.parse(req.query.filters) : {}; } catch { throw badRequest('Bad filters', 'VALIDATION'); }
  const where = [`${s.clinic} = ?`];
  const params = [req.clinicId];
  for (const [key, values] of Object.entries(filters || {})) {
    if (!Array.isArray(values) || !values.length) continue;
    const found = findColumn(s, key);
    if (!found || !s.filters?.includes(key)) throw badRequest(`Can't filter on "${key}"`, 'VALIDATION');
    if (values.length > 1000) throw badRequest('Too many filter values', 'VALIDATION');
    byLine ||= found.line;
    where.push(`COALESCE(CAST(${found.col[2]} AS NVARCHAR(300)), '') IN (?)`);
    params.push(values.map(String));
  }
  if (s.date && isISODate(req.query.from)) { where.push(`${s.date} >= ?`); params.push(req.query.from); }
  if (s.date && isISODate(req.query.to)) { where.push(`${s.date} <= ?`); params.push(req.query.to); }
  if (byLine && !s.lines) byLine = false;
  const rows = await query(
    `SELECT TOP ${MAX_ROWS + 1} ${picked.map((p) => `${p.col[2]} AS [${p.col[0]}]`).join(', ')}
       FROM ${s.from} ${byLine ? s.lines.join : ''}
      WHERE ${where.join(' AND ')}
      ORDER BY ${s.order}${byLine ? `, ${s.lines.order}` : ''}`,
    params,
  );
  res.json({
    grain: byLine ? 'line' : 'document', columns: picked.map((p) => asColumn(s, p.line)(p.col)),
    rows: rows.slice(0, MAX_ROWS), capped: rows.length > MAX_ROWS,
  });
});

export default router;
