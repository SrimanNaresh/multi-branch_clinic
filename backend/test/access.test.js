// Unit tests that need no database:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { can, isGlobalRole, ROLE_PERMISSIONS } from '../../shared/permissions.js';
import { formatPatientCode, formatBillNo, formatEmployeeCode, formatAdminCode, tokenKey } from '../src/utils/codes.js';
import { pick, paging, like, setClause, toAmount } from '../src/utils/http.js';
import { todayISO, addDays, monthStartISO } from '../src/utils/dates.js';
import { clinicScope, requirePermission } from '../src/middleware/access.js';

test('only admins can create branches, employees and patients', () => {
  for (const perm of ['clinic.manage', 'pharmacy.manage', 'lab.manage', 'employee.create', 'patient.create', 'dashboard.view']) {
    assert.equal(can('super_admin', perm), true, perm);
    assert.equal(can('admin', perm), true, perm);
    for (const role of Object.keys(ROLE_PERMISSIONS)) assert.equal(can(role, perm), false, `${role} ${perm}`);
  }
});

test('branch roles get only their own module permissions', () => {
  assert.equal(can('receptionist', 'queue.confirm'), true);
  assert.equal(can('receptionist', 'visit.examine'), false);
  assert.equal(can('doctor', 'visit.examine'), true);
  assert.equal(can('doctor', 'bill.create'), false);
  assert.equal(can('pharmacist', 'dispense'), true);
  assert.equal(can('pharmacist', 'queue.confirm'), false);
  assert.equal(can('billing', 'bill.create'), true);
  assert.equal(can('billing', 'dispense'), false);
  assert.equal(can('unknown', 'patient.view'), false);
  assert.equal(isGlobalRole('admin'), true);
  assert.equal(isGlobalRole('doctor'), false);
});

test('per-clinic codes', () => {
  assert.equal(formatPatientCode('CLA', 1), 'CLA-0001');
  assert.equal(formatPatientCode('CLB', 12345), 'CLB-12345');
  assert.equal(formatBillNo('CLA', 7), 'CLA-B0007');
  assert.equal(formatEmployeeCode('CLA', 3), 'CLA-E003');
  assert.equal(formatAdminCode(1), 'ADM-001');
  assert.equal(tokenKey('2026-10-16'), 'token:2026-10-16');
});

test('http helpers', () => {
  assert.deepEqual(pick({ a: ' x ', b: '', c: 3, d: 4 }, ['a', 'b', 'c']), { a: 'x', b: null, c: 3 });
  assert.deepEqual(paging({ page: '3', limit: '500' }), { limit: 100, page: 3, offset: 200 });
  assert.equal(like('50%_off[x]'), '%50[%][_]off[[]x]%');
  assert.deepEqual(setClause({ name: 'A', status: 'active' }), { sql: '[name] = ?, [status] = ?', params: ['A', 'active'] });
  assert.equal(toAmount('12.345', 'x'), 12.35);
  assert.throws(() => toAmount('-1', 'x'));
});

test('dates in clinic time zone', () => {
  // 20:00 UTC on 16 Oct is already 17 Oct in India
  assert.equal(todayISO(new Date('2026-10-16T20:00:00Z'), 'Asia/Kolkata'), '2026-10-17');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(monthStartISO('2026-10-16'), '2026-10-01');
});

// ---- middleware (clinicScope only hits the DB for admins with a header) ----
const run = async (mw, req) => {
  let err = null;
  try { await mw(req, {}, () => {}); } catch (e) { err = e; }
  return err;
};
const fakeReq = (user, headers = {}, query = {}) => ({ user, query, get: (h) => headers[h.toLowerCase()] });

test('branch users are locked to their own clinic even if they send another clinic id', async () => {
  const req = fakeReq({ role: 'receptionist', clinic_id: 5 }, { 'x-clinic-id': '9' });
  assert.equal(await run(clinicScope(), req), null);
  assert.equal(req.clinicId, 5);
});

test('admin must pick a clinic for branch modules; optional scope means all clinics', async () => {
  const req = fakeReq({ role: 'admin', clinic_id: null });
  const err = await run(clinicScope(), req);
  assert.equal(err.status, 400);
  assert.equal(err.code, 'CLINIC_REQUIRED');

  const req2 = fakeReq({ role: 'admin', clinic_id: null }, { 'x-clinic-id': 'all' });
  assert.equal(await run(clinicScope({ optional: true }), req2), null);
  assert.equal(req2.clinicId, null);
});

test('requirePermission blocks roles without access', async () => {
  const err = await run(requirePermission('patient.create'), fakeReq({ role: 'receptionist' }));
  assert.equal(err.status, 403);
  assert.equal(await run(requirePermission('patient.create'), fakeReq({ role: 'admin' })), null);
  assert.equal(await run(requirePermission('dispense', 'bill.create'), fakeReq({ role: 'billing' })), null);
});
