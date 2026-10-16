// Tests for the dependency-free server pieces (router, tokens, passwords)
import test from 'node:test';
import assert from 'node:assert/strict';
import express, { Router } from '../src/lib/mini-express.js';
import { signJwt, verifyJwt, hashPassword, checkPassword } from '../src/lib/security.js';

test('login token round-trip, tamper and expiry', () => {
  const t = signJwt({ sub: 7, role: 'doctor' }, 'secret', '1h');
  assert.equal(verifyJwt(t, 'secret').sub, 7);
  assert.throws(() => verifyJwt(t, 'other-secret'));
  assert.throws(() => verifyJwt(t.slice(0, -2) + 'xx', 'secret'));
  const old = signJwt({ sub: 1 }, 's', '0s');
  const [h, , s] = old.split('.');
  const expired = Buffer.from(JSON.stringify({ sub: 1, exp: 1 })).toString('base64url');
  assert.throws(() => verifyJwt(`${h}.${expired}.${s}`, 's'));
});

test('password hash fits the column and verifies', async () => {
  const h = await hashPassword('ChangeMe@123');
  assert.ok(h.length <= 100, `hash length ${h.length}`);
  assert.equal(await checkPassword('ChangeMe@123', h), true);
  assert.equal(await checkPassword('wrong', h), false);
  assert.equal(await checkPassword('x', '$2a$10$oldbcrypt'), false);
});

test('router: mount paths, params, async errors, error handler', async () => {
  const app = express();
  app.use(express.json());
  const r = Router();
  r.use((req, _res, next) => { req.seen = true; next(); });
  r.get('/search', (req, res) => res.json({ q: req.query.q, seen: req.seen }));
  r.patch('/:id/status', (req, res) => res.json({ id: req.params.id, status: req.body.status }));
  r.get('/boom', async () => { throw Object.assign(new Error('nope'), { status: 418 }); });
  app.use('/api/queue', r);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'nf' }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/queue/search?q=ram`)).json(), { q: 'ram', seen: true });
    const p = await fetch(`${base}/api/queue/12/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"status":"done"}' });
    assert.deepEqual(await p.json(), { id: '12', status: 'done' });
    const b = await fetch(`${base}/api/queue/boom`);
    assert.equal(b.status, 418);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
    const bad = await fetch(`${base}/api/queue/1/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
