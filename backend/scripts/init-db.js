// Creates the database and all tables from database/schema.sql
//   npm run db:init
import '../src/config/load-env.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { explainDbError } from './db-errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '../../database/schema.sql');
const dbName = process.env.DB_NAME || 'smartclinic';

let sql = await readFile(schemaPath, 'utf8');
// Allow a custom DB_NAME
sql = sql.replace(/CREATE DATABASE IF NOT EXISTS smartclinic/, `CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
         .replace(/USE smartclinic;/, `USE \`${dbName}\`;`);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
  charset: 'utf8mb4',
}).catch(explainDbError);
await conn.query(sql).catch(explainDbError);
await conn.end();
console.log(`Schema applied to database "${dbName}".`);
