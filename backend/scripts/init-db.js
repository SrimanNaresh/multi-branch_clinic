// Creates all SmartClinic tables in the SQL Server database named in DB_NAME
// (creates the database first if it does not exist and the login is allowed to).
//   node scripts/init-db.js
import '../src/config/load-env.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import tedious from 'tedious';
import { env } from '../src/config/env.js';
import { explainDbError } from './db-errors.js';

const { Connection, Request } = tedious;
const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '../../database/schema.sql');

function open(database) {
  const options = {
    database, encrypt: env.db.encrypt, trustServerCertificate: env.db.trustServerCertificate,
    connectTimeout: 20000, requestTimeout: 120000,
  };
  if (env.db.instance) options.instanceName = env.db.instance;
  else options.port = env.db.port;
  return new Promise((resolve, reject) => {
    const conn = new Connection({
      server: env.db.host,
      authentication: { type: 'default', options: { userName: env.db.user, password: env.db.password } },
      options,
    });
    conn.connect((err) => (err ? reject(err) : resolve(conn)));
  });
}

const run = (conn, sql) => new Promise((resolve, reject) => {
  conn.execSqlBatch(new Request(sql, (err) => (err ? reject(err) : resolve())));
});

const name = env.db.database;
if (!/^[A-Za-z0-9_]+$/.test(name)) explainDbError({ message: `DB_NAME "${name}" may contain only letters, digits and _` });

console.log(`Connecting to SQL Server ${env.db.host}${env.db.instance ? '\\' + env.db.instance : ':' + env.db.port} as ${env.db.user} ...`);
let conn;
try {
  conn = await open(name);
} catch (err) {
  // "Cannot open database" → create it from master
  if (/Cannot open database/i.test(String(err.message))) {
    console.log(`Database ${name} not found – creating it ...`);
    const master = await open('master').catch(explainDbError);
    await run(master, `IF DB_ID(N'${name}') IS NULL CREATE DATABASE [${name}]`).catch(explainDbError);
    master.close();
    conn = await open(name).catch(explainDbError);
  } else {
    explainDbError(err);
  }
}

const schema = await readFile(schemaPath, 'utf8');
const batches = schema.split(/^\s*GO\s*$/im).map((b) => b.trim())
  .filter((b) => b.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim());
for (const [i, batch] of batches.entries()) {
  try {
    await run(conn, batch);
  } catch (err) {
    console.error(`\nStep ${i + 1} of ${batches.length} failed:\n${batch.split('\n').slice(0, 3).join('\n')} ...`);
    explainDbError(err);
  }
}
conn.close();
console.log(`Tables are ready in database "${name}" (${batches.length} steps).`);
