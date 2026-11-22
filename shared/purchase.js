// Pharmacy → Purchase / Order: the sums for one item line and the whole order.
// Shared by the screen (shown as you type) and the server (which saves its own result).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** P.Rate from MRP and Disc %: MRP − MRP × Disc % / 100 (MRP 100, Disc 10 → 90) */
export const pRateOf = (mrp, disc) => r2(Number(mrp || 0) - (Number(mrp || 0) * Number(disc || 0)) / 100);

/** Disc % from MRP and P.Rate: (1 − P.Rate / MRP) × 100 (MRP 100, P.Rate 90 → 10); 0 when there is no MRP */
export const discOf = (mrp, pRate) => (Number(mrp) > 0 ? r2((1 - Number(pRate || 0) / Number(mrp)) * 100) : 0);

/**
 * MRP, Disc % and P.Rate are linked (Disc % is a % of the MRP; P.Rate is what is paid per pack):
 * Amount = Qty × P.Rate (Free units are not charged); GST Amount = Amount / 100 × (CGST + SGST);
 * Total = Amount + GST Amount. disc_percent is worked out from MRP and P.Rate; rate (the saved Cur.Rate) = P.Rate.
 */
export function calcLine({ mrp, p_rate: pRate, qty, cgst_percent: cgst, sgst_percent: sgst }) {
  const rate = r2(pRate);
  const amount = r2(Number(qty || 0) * rate);
  const gst = r2(Number(cgst || 0) + Number(sgst || 0));
  const gstAmount = r2((amount / 100) * gst);
  return { disc_percent: discOf(mrp, rate), rate, amount, gst_percent: gst, gst_amount: gstAmount, total: r2(amount + gstAmount) };
}

/**
 * A line after one box is typed, with MRP, Disc % and P.Rate kept linked:
 * typing Disc % (or MRP, when a Disc % is set) works out P.Rate; typing P.Rate (or MRP, when Disc % is empty)
 * works out Disc %. Empty boxes stay empty.
 */
export function linkPrice(line, patch) {
  const l = { ...line, ...patch };
  const mrp = Number(l.mrp) || 0;
  const has = (v) => v !== '' && v != null;
  if ('disc_percent' in patch || ('mrp' in patch && has(l.disc_percent))) {
    if (mrp > 0 && has(l.disc_percent)) l.p_rate = pRateOf(mrp, l.disc_percent);
  } else if ('p_rate' in patch || 'mrp' in patch) {
    l.disc_percent = mrp > 0 && has(l.p_rate) ? discOf(mrp, l.p_rate) : '';
  }
  return l;
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
