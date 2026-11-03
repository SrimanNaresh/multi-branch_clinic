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
