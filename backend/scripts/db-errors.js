// Turns common SQL Server connection errors into plain instructions.
export function explainDbError(err) {
  const msg = String(err?.message || err);
  let tip;
  if (err?.code === 'ELOGIN') tip = 'SQL Server rejected the login. Check DB_USER / DB_PASSWORD in backend/.env, and that the login may open DB_NAME.';
  else if (err?.code === 'ESOCKET' || err?.code === 'ETIMEOUT') tip = 'Cannot reach SQL Server. Check DB_HOST / DB_PORT in backend/.env, that SQL Server allows TCP/IP connections, and that port 1433 is open in the server firewall.';
  else if (err?.code === 'EINSTLOOKUP') tip = 'Named instance not found. Check DB_INSTANCE in backend/.env (or clear it and set DB_PORT).';
  else if (/certificate|self[- ]signed|SSL|TLS/i.test(msg)) tip = 'Encrypted connection failed. In backend/.env set DB_TRUST_CERT=true (or DB_ENCRYPT=false for an old server).';
  else if (err?.number === 262 || /permission/i.test(msg)) tip = 'This login does not have permission to create tables/databases. Use a login with db_owner rights on DB_NAME.';
  console.error('\n*** Database setup failed ***');
  console.error(tip || msg);
  if (tip) console.error(`(details: ${msg})`);
  console.error('');
  process.exit(1);
}
