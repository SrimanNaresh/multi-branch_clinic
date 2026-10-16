import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  ...env.db,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,      // DATE/DATETIME come back as strings – no TZ surprises
  decimalNumbers: true,   // DECIMAL → number
  namedPlaceholders: false,
});

// NOW() / CURRENT_TIMESTAMP in the clinic's local time, so "today" matches the front desk.
pool.on('connection', (conn) => {
  const r = conn.query(`SET time_zone = '${env.dbTimeZone}'`);
  // never let this crash the process; worst case the server's own time zone is used
  if (r && typeof r.catch === 'function') r.catch(() => {});
  else if (r && typeof r.on === 'function') r.on('error', () => {});
});

/** Run one statement on the pool. Returns rows (SELECT) or the result header. */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run `fn(q)` inside a transaction. `q(sql, params)` works like `query`. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, params = []) => (await conn.query(sql, params))[0];
    const result = await fn(q);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
