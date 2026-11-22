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

/** Round Off: what takes the total to the nearest rupee (102.40 → −0.40, 102.50 → +0.50) */
export const roundOffOf = (total) => r2(Math.round(r2(total)) - r2(total));

/**
 * The order's footer: Sum of Total, an optional whole-bill discount (disc_percent of the Sum, taken off before
 * Round Off), Round Off (when asked) and Net Amount. With no discount this is Sum + Round Off, as before.
 */
export function orderTotals(sum, discPercent = 0, round = false) {
  const s = r2(sum);
  const discAmount = r2((s * Number(discPercent || 0)) / 100);
  const afterDisc = r2(s - discAmount);
  const roundOff = round ? roundOffOf(afterDisc) : 0;
  return { sum: s, disc_amount: discAmount, round_off: roundOff, total: r2(afterDisc + roundOff) };
}
