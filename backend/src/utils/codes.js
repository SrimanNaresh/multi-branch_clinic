// Per-clinic running numbers: patient IDs, bill numbers, employee codes, daily tokens.
// Must be called with the `q` of an open transaction: the upsert row-locks the
// sequence row until commit, so two receptionists can never get the same number.

export const GLOBAL_SEQ_CLINIC = 0;

export async function nextSequence(q, clinicId, key) {
  await q(
    `INSERT INTO code_sequences (clinic_id, seq_key, last_value) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE last_value = last_value + 1`,
    [clinicId, key],
  );
  const rows = await q('SELECT last_value FROM code_sequences WHERE clinic_id = ? AND seq_key = ?', [clinicId, key]);
  return rows[0].last_value;
}

const pad = (n, width) => String(n).padStart(width, '0');

export const formatPatientCode = (clinicCode, n) => `${clinicCode}-${pad(n, 4)}`;     // CLA-0001
export const formatBillNo = (clinicCode, n) => `${clinicCode}-B${pad(n, 4)}`;         // CLA-B0001
export const formatEmployeeCode = (clinicCode, n) => `${clinicCode}-E${pad(n, 3)}`;   // CLA-E001
export const formatAdminCode = (n) => `ADM-${pad(n, 3)}`;                            // ADM-001
export const tokenKey = (isoDate) => `token:${isoDate}`;
