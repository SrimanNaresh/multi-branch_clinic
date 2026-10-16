// Login tokens (JWT, HS256) and password hashing (scrypt) using only node:crypto.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const b64u = (v) => Buffer.from(v).toString('base64url');

function seconds(expiresIn) {
  const m = String(expiresIn).match(/^(\d+)\s*([smhd]?)$/);
  if (!m) return 12 * 3600;
  return Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

export function signJwt(payload, secret, expiresIn = '12h') {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + seconds(expiresIn) }));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
  return payload;
}

// Stored as "scrypt$<salt>$<hash>" (fits the VARCHAR(100) column)
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${Buffer.from(hash).toString('base64')}`;
}

export async function checkPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const isCurrentHash = (stored) => typeof stored === 'string' && stored.startsWith('scrypt$');
