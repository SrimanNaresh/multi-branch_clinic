// Pharmacy → Purchase / Order: the sums for one item line and the whole order.
// Shared by the screen (shown as you type) and the server (which saves its own result).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Rate = P.Rate − Disc % of P.Rate; Amount = Qty × Rate (Free units are not charged);
 * GST Amount = Amount / 100 × (CGST + SGST); Total = Amount + GST Amount
 */
export function calcLine({ p_rate: pRate, disc_percent: disc, qty, cgst_percent: cgst, sgst_percent: sgst }) {
  const rate = r2(Number(pRate || 0) - (Number(pRate || 0) * Number(disc || 0)) / 100);
  const amount = r2(Number(qty || 0) * rate);
  const gst = r2(Number(cgst || 0) + Number(sgst || 0));
  const gstAmount = r2((amount / 100) * gst);
  return { rate, amount, gst_percent: gst, gst_amount: gstAmount, total: r2(amount + gstAmount) };
}

/** GST % typed in one box: split evenly into CGST % and SGST % */
export const splitGst = (gst) => {
  const half = r2(Number(gst || 0) / 2);
  return { cgst_percent: half, sgst_percent: r2(Number(gst || 0) - half) };
};

/** Sum of Total over the lines */
export const orderTotal = (lines) => r2(lines.reduce((s, l) => s + calcLine(l).total, 0));
