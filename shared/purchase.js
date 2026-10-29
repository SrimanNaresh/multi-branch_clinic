// Pharmacy → Purchase / Order: the sums for one item line and the whole order.
// Shared by the screen (shown as you type) and the server (which saves its own result).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Cur.Rate = MRP − Disc % of MRP; Amount = Qty × Cur.Rate; GST Amount = Amount / 100 × (CGST + SGST); Total = Amount + GST Amount */
export function calcLine({ mrp, disc_percent: disc, qty, cgst_percent: cgst, sgst_percent: sgst }) {
  const rate = r2(Number(mrp || 0) - (Number(mrp || 0) * Number(disc || 0)) / 100);
  const amount = r2(Number(qty || 0) * rate);
  const gst = r2(Number(cgst || 0) + Number(sgst || 0));
  const gstAmount = r2((amount / 100) * gst);
  return { rate, amount, gst_percent: gst, gst_amount: gstAmount, total: r2(amount + gstAmount) };
}

/** Sum of Total over the lines */
export const orderTotal = (lines) => r2(lines.reduce((s, l) => s + calcLine(l).total, 0));
