import { HttpError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
}

let lastDbHint = 0;
function dbHint(text) {
  // print each connection hint at most once a minute, so the window stays readable
  if (Date.now() - lastDbHint > 60000) { console.error(text); lastDbHint = Date.now(); }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON body', code: 'VALIDATION' } });
  }

  // SQL Server connection problems (Tedious ConnectionError codes)
  if (err?.code === 'ELOGIN') {
    dbHint(`SQL Server refused the login: ${err.message}\n -> Check DB_USER / DB_PASSWORD / DB_NAME in backend/.env`);
    return res.status(503).json({ error: { message: 'Database login failed. Check DB_USER, DB_PASSWORD and DB_NAME in backend/.env.', code: 'DB_AUTH' } });
  }
  if (['ESOCKET', 'ETIMEOUT', 'EINSTLOOKUP', 'ECONNREFUSED'].includes(err?.code)) {
    dbHint(`Cannot reach SQL Server: ${err.message}\n -> Check DB_HOST / DB_PORT in backend/.env, and that port 1433 is open in the server firewall`);
    return res.status(503).json({ error: { message: 'Cannot connect to the database server. Check the network and DB_HOST in backend/.env.', code: 'DB_DOWN' } });
  }

  // SQL Server request errors (error numbers)
  switch (err?.number) {
    case 2627: case 2601:
      return res.status(409).json({ error: { message: 'A record with the same code / name already exists', code: 'DUPLICATE' } });
    case 547: {
      const fk = /FOREIGN KEY|REFERENCE/i.test(err.message || '');
      return res.status(400).json({ error: { message: fk ? 'Linked record does not exist' : 'Invalid value (it breaks a database rule)', code: 'VALIDATION' } });
    }
    case 208:
      dbHint(`Table missing: ${err.message}\n -> Run the setup step: node scripts/init-db.js`);
      return res.status(503).json({ error: { message: 'Database tables are not created yet. Run the setup step first.', code: 'DB_MISSING' } });
    case 4060:
      return res.status(503).json({ error: { message: 'Cannot open the database named in DB_NAME. Check backend/.env.', code: 'DB_MISSING' } });
    default:
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { message: 'Something went wrong', code: 'SERVER_ERROR' } });
}
