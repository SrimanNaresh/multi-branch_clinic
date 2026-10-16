// Turns common MySQL connection errors into plain instructions.
export function explainDbError(err) {
  const tips = {
    ECONNREFUSED: 'MySQL is not running. Start it (XAMPP: click Start next to MySQL) and try again.',
    ENOTFOUND: 'DB_HOST in backend/.env is wrong. Use localhost.',
    ETIMEDOUT: 'MySQL did not answer. Check DB_HOST / DB_PORT in backend/.env.',
    ER_ACCESS_DENIED_ERROR: 'MySQL rejected the login. Fix DB_USER / DB_PASSWORD in backend/.env.',
    ER_NOT_SUPPORTED_AUTH_MODE: 'Your MySQL user uses an old login method. Update MySQL or the user password.',
  };
  console.error('\n*** Database setup failed ***');
  console.error(tips[err?.code] || `${err?.code || ''} ${err?.message || err}`);
  console.error('');
  process.exit(1);
}
