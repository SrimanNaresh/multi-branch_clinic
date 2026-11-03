// Pharmacy → Sales: the sums of a counter sale. Shared by the screen (shown as you type) and the server
// (which saves its own result). A line sells packs or single units ('pack' | 'unit'); stock is counted in packs.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** How many of the line's sale units make one pack: the pack size when selling by unit, else 1 */
export const unitsPerPack = (saleUnit, packSize) => (saleUnit === 'unit' ? Number(packSize) || 1 : 1);

/** A pack price shown per sale unit (MRP 30.00, a 15's pack sold by unit → 2.00) */
export const perSaleUnit = (packPrice, saleUnit, packSize) => r2(Number(packPrice || 0) / unitsPerPack(saleUnit, packSize));

/** The packs a line takes out of stock (5 units of a 15's pack → 0.3333) */
export const packsOf = ({ qty, sale_unit: saleUnit, pack_size: packSize }) => r4(Number(qty || 0) / unitsPerPack(saleUnit, packSize));

/** Amount = Quantity × Sale Price less Disc % */
export const lineAmount = ({ qty, price, disc_percent: disc }) => r2(Number(qty || 0) * Number(price || 0) * (1 - Number(disc || 0) / 100));

/** What the line cost to buy: Quantity × the batch's purchase price per pack, per sale unit */
export const lineCost = ({ qty, sale_unit: saleUnit, pack_size: packSize, cost }) =>
  r2((Number(qty || 0) * Number(cost || 0)) / unitsPerPack(saleUnit, packSize));

/** Sub Total = Σ Amount; Discount = Bill Discount % of it; TOTAL = Sub Total − Discount; Cost = Σ line cost */
export function saleTotals(lines, discPercent) {
  const sub = r2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const discount = r2((sub * Number(discPercent || 0)) / 100);
  return { sub_total: sub, discount_amount: discount, total_amount: r2(sub - discount), cost: r2(lines.reduce((s, l) => s + lineCost(l), 0)) };
}
