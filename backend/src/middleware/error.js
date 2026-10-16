import { HttpError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON body', code: 'VALIDATION' } });
  }
  // MySQL errors worth turning into friendly messages
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { message: 'A record with the same code / name already exists', code: 'DUPLICATE' } });
  }
  if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(400).json({ error: { message: 'Invalid value: ' + err.sqlMessage, code: 'VALIDATION' } });
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(err?.code)) {
    console.error('Cannot reach MySQL. Is it running? Check DB_HOST / DB_PORT in backend/.env');
    return res.status(503).json({ error: { message: 'Cannot connect to the database. Start MySQL and try again.', code: 'DB_DOWN' } });
  }
  if (err?.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('MySQL refused the login. Fix DB_USER / DB_PASSWORD in backend/.env');
    return res.status(503).json({ error: { message: 'Database login failed. Check DB_USER and DB_PASSWORD in backend/.env.', code: 'DB_AUTH' } });
  }
  if (err?.code === 'ER_BAD_DB_ERROR') {
    console.error('Database not created yet. Run: node scripts/init-db.js');
    return res.status(503).json({ error: { message: 'Database not set up yet. Run the setup step first.', code: 'DB_MISSING' } });
  }
  if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: { message: 'Linked record does not exist', code: 'VALIDATION' } });
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { message: 'Something went wrong', code: 'SERVER_ERROR' } });
}
