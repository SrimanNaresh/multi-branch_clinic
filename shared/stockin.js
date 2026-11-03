// Pharmacy → Stock In: the selling price of a received line.
// Shared by the screen (shown as you type) and the server (which saves its own result).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Sel.Amount = MRP less S.Disc % (the selling discount). MRP 32.12, S.Disc 5 → 30.51 */
export const selAmount = ({ mrp, disc_percent: disc }) => r2(Number(mrp || 0) * (1 - Number(disc || 0) / 100));

/** The number of pieces in one pack: Item Master Type / Unit when it is a number ('15' → 15), else 1 */
export function packSize(unit) {
  const s = String(unit ?? '').trim();
  return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? Number(s) : 1;
}

/** Unit Price = Sel.Amount ÷ the pieces in the pack. 30.51 ÷ 15 → 2.03 */
export const unitPrice = (sel, unit) => r2(Number(sel || 0) / packSize(unit));
