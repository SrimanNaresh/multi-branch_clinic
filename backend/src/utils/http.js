export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have access to this action') => new HttpError(403, msg, 'FORBIDDEN');
export const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

/** Copy only the listed keys that are present in `src`; '' becomes null. */
export function pick(src = {}, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      const v = src[k];
      out[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
    }
  }
  return out;
}

export function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length) throw badRequest(`Required: ${missing.join(', ')}`, 'VALIDATION');
}

export function oneOf(value, allowed, field) {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`, 'VALIDATION');
  }
}

export function toId(v, field = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${field}`, 'VALIDATION');
  return n;
}

export function toAmount(v, field, { min = 0 } = {}) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw badRequest(`Invalid ${field}`, 'VALIDATION');
  return Math.round(n * 100) / 100;
}

export function paging(query, { maxLimit = 100, defaultLimit = 25 } = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

/** Build "SET a=?, b=?" for an UPDATE from a plain object. */
export function setClause(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) throw badRequest('Nothing to update', 'VALIDATION');
  return { sql: keys.map((k) => `[${k}] = ?`).join(', '), params: keys.map((k) => fields[k]) };
}

// SQL Server LIKE: wrap % _ [ in brackets so they match literally
export const like = (q) => `%${String(q).replace(/[%_[]/g, (m) => `[${m}]`)}%`;
