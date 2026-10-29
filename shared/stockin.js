// Pharmacy → Stock In: the selling price of a received line.
// Shared by the screen (shown as you type) and the server (which saves its own result).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Sel.Amount = Cur.Rate + Sales % of it, then less Discount %. Rate 90, Sales 20, Disc 5 → 108 → 102.60 */
export function selAmount({ rate, sales_percent: sales, disc_percent: disc }) {
  const withMargin = Number(rate || 0) * (1 + Number(sales || 0) / 100);
  return r2(withMargin * (1 - Number(disc || 0) / 100));
}
