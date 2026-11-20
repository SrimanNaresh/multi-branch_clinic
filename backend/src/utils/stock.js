import { badRequest } from './http.js';

// Pharmacy stock helpers shared by Stock In, Return and Sales.

/** Stock quantities keep 4 decimals: a unit sale takes a part of a pack (5 of a 15's pack = 0.3333). */
export const r4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;

/** Admin = the clinic-wide roles; only they may edit / delete a saved Stock In or delete an order. */
export const isAdmin = (user) => user?.role === 'admin' || user?.role === 'super_admin';

/**
 * Serialises stock-changing saves of one clinic inside the transaction `q`, so two bills can't both take
 * the last units of a batch. Released when the transaction ends.
 */
export async function lockStock(q, clinicId) {
  await q(`EXEC sp_getapplock @Resource = ?, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000`,
    [`pharmacy-stock-${clinicId}`]);
}

/**
 * SQL for the packs left in one batch (`a` = a stock_in_items alias): received (paid + free) − returned to the
 * vendor − sold + returned by customers + adjusted in − adjusted out. Takes 3 parameters, in this order: the
 * sale, the sales return and the stock adjustment whose own lines are to be left out (0 = none).
 */
export const batchLeftSql = (a = 'l') => `(${a}.qty + ${a}.free_qty
  - COALESCE((SELECT SUM(r.qty) FROM purchase_return_items r WHERE r.stock_in_item_id = ${a}.id), 0)
  - COALESCE((SELECT SUM(s.qty) FROM sale_items s WHERE s.stock_in_item_id = ${a}.id AND s.sale_id <> ?), 0)
  + COALESCE((SELECT SUM(x.qty) FROM sales_return_items x WHERE x.stock_in_item_id = ${a}.id AND x.sales_return_id <> ?), 0)
  + COALESCE((SELECT SUM(j.in_qty - j.out_qty) FROM stock_adjustment_items j WHERE j.stock_in_item_id = ${a}.id AND j.adjustment_id <> ?), 0))`;

/** Refuses the save when any of these batches would be left with less than nothing (call after the change). */
export async function assertBatchesNotNegative(q, clinicId, batchIds) {
  const ids = [...new Set(batchIds.filter(Boolean).map(Number))];
  if (!ids.length) return;
  const rows = await q(
    `SELECT l.item_name, l.batch_no, ${batchLeftSql('l')} AS left_qty FROM stock_in_items l
      WHERE l.clinic_id = ? AND l.id IN (${ids.map(() => '?').join(', ')})`,
    [0, 0, 0, clinicId, ...ids],
  );
  const bad = rows.find((r) => Number(r.left_qty) < -0.00005);
  if (bad) throw badRequest(`${bad.item_name} (batch ${bad.batch_no || '—'}): not enough stock left in the batch`, 'VALIDATION');
}

/**
 * Moves item stock by `change` (item_id → +/− packs) and logs each move in stock_movements.
 * `log` = { reason, ref_type, ref_id, supplier_id?, note }. Stock never goes below zero.
 */
export async function moveItemStock(q, clinicId, userId, change, log) {
  for (const [itemId, diff] of change) {
    if (!r4(diff)) continue;
    const [item] = await q('SELECT name, stock_qty FROM items WITH (UPDLOCK, ROWLOCK) WHERE id = ? AND clinic_id = ?', [itemId, clinicId]);
    if (!item) throw badRequest('Item not found', 'VALIDATION');
    const balance = r4(Number(item.stock_qty) + diff);
    if (balance < 0) throw badRequest(`${item.name}: only ${r4(item.stock_qty)} in stock`, 'VALIDATION');
    await q('UPDATE items SET stock_qty = ?, updated_at = NOW() WHERE id = ?', [balance, itemId]);
    await q(
      `INSERT INTO stock_movements (clinic_id, item_id, qty_change, balance_after, reason, ref_type, ref_id, supplier_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clinicId, itemId, r4(diff), balance, log.reason, log.ref_type, log.ref_id ?? null, log.supplier_id ?? null, log.note ?? null, userId],
    );
  }
}
