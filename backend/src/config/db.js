// Microsoft SQL Server access on the bundled Tedious driver.
//
//   query(sql, params)  – run one batch on a pooled connection. Returns the rows
//                          (an array) with .affectedRows for INSERT/UPDATE/DELETE.
//   tx(async (q) => …)  – run several statements in one transaction; q works like query.
//   insertRow(q, table, obj)          → new id   (INSERT … OUTPUT INSERTED.id)
//   updateRow(q, table, obj, where, params) → rows changed (also sets updated_at)
//
// SQL is written with "?" placeholders (an array value expands to a list for IN (?)),
// and NOW() means "now in clinic time". Dates come back as 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS'.
import tedious from 'tedious';
import { env } from './env.js';

const { Connection, Request, TYPES, ISOLATION_LEVEL } = tedious;

export const NOW_SQL = `DATEADD(MINUTE, ${env.tzOffsetMinutes}, SYSUTCDATETIME())`;

const TABLES_WITH_UPDATED_AT = new Set(['clinics', 'pharmacies', 'labs', 'employees', 'patients', 'visits', 'items', 'suppliers', 'bills', 'code_sequences']);

function connectionConfig() {
  const options = {
    database: env.db.database,
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
    connectTimeout: 20000,
    requestTimeout: 30000,
    useUTC: true,               // we store clinic wall-clock time; read it back unchanged
    rowCollectionOnRequestCompletion: false,
  };
  if (env.db.instance) options.instanceName = env.db.instance;
  else options.port = env.db.port;
  return {
    server: env.db.host,
    authentication: { type: 'default', options: { userName: env.db.user, password: env.db.password } },
    options,
  };
}

/* ---------------- SQL compilation ---------------- */

/** Replace ? with @p0, @p1… (outside quotes); arrays expand to @p0, @p1, … */
export function compileSql(sql, params = []) {
  const values = [];
  let out = '';
  let pi = 0;
  let inQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inQuote = !inQuote;
    if (ch === '?' && !inQuote) {
      if (pi >= params.length) throw new Error(`Missing value for placeholder ${pi + 1} in: ${sql.slice(0, 80)}`);
      const v = params[pi++];
      if (Array.isArray(v)) {
        if (!v.length) { out += 'NULL'; continue; }
        out += v.map((x) => { values.push(x); return `@p${values.length - 1}`; }).join(', ');
      } else {
        values.push(v);
        out += `@p${values.length - 1}`;
      }
      continue;
    }
    out += ch;
  }
  out = out.replace(/\bNOW\(\)/g, NOW_SQL);
  return { text: out, values };
}

function paramType(v) {
  if (v === null || v === undefined) return [TYPES.NVarChar, null];
  if (typeof v === 'boolean') return [TYPES.Bit, v];
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return Math.abs(v) <= 2147483647 ? [TYPES.Int, v] : [TYPES.BigInt, String(v)];
    return [TYPES.Decimal, v, { precision: 18, scale: 4 }];
  }
  if (v instanceof Date) return [TYPES.DateTime2, v, { scale: 0 }];
  if (typeof v === 'object') return [TYPES.NVarChar, JSON.stringify(v)];
  return [TYPES.NVarChar, String(v)];
}

const pad = (n) => String(n).padStart(2, '0');
function readValue(value, typeName) {
  if (value instanceof Date) {
    const iso = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    if (typeName === 'Date' || typeName === 'DateN') return iso;
    return `${iso} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;   // BIT → 1/0
  if (typeof value === 'string' && /^(Decimal|Numeric)/.test(typeName)) return Number(value);
  return value;
}

function exec(conn, sql, params) {
  const { text, values } = compileSql(sql, params);
  return new Promise((resolve, reject) => {
    const rows = [];
    const req = new Request(text, (err, rowCount) => {
      if (err) return reject(err);
      rows.affectedRows = rowCount;
      resolve(rows);
    });
    values.forEach((v, i) => {
      const [type, val, opts] = paramType(v);
      req.addParameter(`p${i}`, type, val, opts);
    });
    req.on('row', (columns) => {
      const o = {};
      for (const c of columns) o[c.metadata.colName] = readValue(c.value, c.metadata.type.name);
      rows.push(o);
    });
    conn.execSql(req);
  });
}

/* ---------------- connection pool ---------------- */

const MAX = env.db.poolSize;
const idle = [];
const waiters = [];
let open = 0;

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Connection(connectionConfig());
    conn.on('error', () => { conn.broken = true; });
    conn.on('end', () => { conn.broken = true; });
    conn.connect((err) => {
      if (err) return reject(err);
      exec(conn, 'SET XACT_ABORT ON; SET DATEFORMAT ymd;').then(() => resolve(conn), reject);
    });
  });
}

async function acquire() {
  while (idle.length) {
    const c = idle.pop();
    if (!c.broken) return c;
    open--;
  }
  if (open < MAX) {
    open++;
    try { return await connect(); } catch (e) { open--; throw e; }
  }
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

function release(conn) {
  if (conn.broken) {
    open--;
    try { conn.close(); } catch { /* already closed */ }
    const w = waiters.shift();
    if (w) { open++; connect().then(w.resolve, (e) => { open--; w.reject(e); }); }
    return;
  }
  const w = waiters.shift();
  if (w) w.resolve(conn);
  else idle.push(conn);
}

export async function query(sql, params = []) {
  const conn = await acquire();
  try {
    return await exec(conn, sql, params);
  } finally {
    release(conn);
  }
}

export async function tx(fn) {
  const conn = await acquire();
  const call = (method, ...args) => new Promise((resolve, reject) => conn[method]((e) => (e ? reject(e) : resolve()), ...args));
  try {
    await call('beginTransaction', '', ISOLATION_LEVEL.READ_COMMITTED);
    const q = (sql, params = []) => exec(conn, sql, params);
    try {
      const result = await fn(q);
      await call('commitTransaction');
      return result;
    } catch (err) {
      try { await call('rollbackTransaction'); } catch { conn.broken = true; }
      throw err;
    }
  } finally {
    release(conn);
  }
}

export async function closePool() {
  for (const c of idle.splice(0)) { try { c.close(); } catch { /* ignore */ } }
  open = 0;
}

/* ---------------- helpers ---------------- */

const col = (k) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`Bad column name: ${k}`);
  return `[${k}]`;
};

export async function insertRow(q, table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const sql = `INSERT INTO ${col(table)} (${keys.map(col).join(', ')}) OUTPUT INSERTED.id VALUES (${keys.map(() => '?').join(', ')})`;
  const rows = await q(sql, keys.map((k) => obj[k]));
  return rows[0].id;
}

export async function updateRow(q, table, obj, whereSql, whereParams = []) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return 0;
  const sets = keys.map((k) => `${col(k)} = ?`);
  if (TABLES_WITH_UPDATED_AT.has(table) && !keys.includes('updated_at')) sets.push('[updated_at] = NOW()');
  const r = await q(`UPDATE ${col(table)} SET ${sets.join(', ')} WHERE ${whereSql}`, [...keys.map((k) => obj[k]), ...whereParams]);
  return r.affectedRows;
}

/** Paging clause for SQL Server (needs an ORDER BY before it). */
export const pageSql = 'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY';

/** SQL Server error numbers we turn into friendly API errors. */
export const isDuplicateKey = (e) => e?.number === 2627 || e?.number === 2601;
