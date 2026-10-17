// User-wise access (Menu Permission) rules:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS, GLOBAL_ONLY_PERMISSIONS, effectivePermissions, grantablePermissions, overridesFor, rolePermissions, userCan,
} from '../../shared/permissions.js';
import { requirePermission } from '../src/middleware/access.js';

test('without changes everyone keeps the role defaults', () => {
  assert.deepEqual(effectivePermissions('receptionist', []), rolePermissions('receptionist'));
  assert.deepEqual(effectivePermissions('admin', []), ALL_PERMISSIONS);
});

test('a permission can be added to or removed from one employee', () => {
  const p = effectivePermissions('receptionist', [{ permission: 'patient.create', granted: true }, { permission: 'queue.update', granted: false }]);
  assert.ok(p.includes('patient.create'));
  assert.ok(!p.includes('queue.update'));
  assert.ok(p.includes('queue.confirm'));
});

test('branch staff never get main-office powers; Super Admin always has everything', () => {
  for (const perm of GLOBAL_ONLY_PERMISSIONS) {
    assert.ok(!effectivePermissions('doctor', [{ permission: perm, granted: true }]).includes(perm), perm);
    assert.ok(!grantablePermissions('billing').includes(perm), perm);
  }
  assert.deepEqual(effectivePermissions('super_admin', [{ permission: 'dashboard.view', granted: false }]), ALL_PERMISSIONS);
  assert.deepEqual(grantablePermissions('super_admin'), []);
  assert.ok(!effectivePermissions('admin', [{ permission: 'bill.cancel', granted: false }]).includes('bill.cancel'));
});

test('overridesFor stores only the differences and round-trips', () => {
  assert.deepEqual(overridesFor('doctor', rolePermissions('doctor')), []);
  const wanted = [...rolePermissions('doctor').filter((p) => p !== 'item.view'), 'bill.view'];
  const o = overridesFor('doctor', wanted);
  assert.deepEqual(o, [{ permission: 'item.view', granted: false }, { permission: 'bill.view', granted: true }]);
  assert.deepEqual(new Set(effectivePermissions('doctor', o)), new Set(wanted));
});

test('checks use the loaded permission list when there is one', () => {
  assert.equal(userCan({ role: 'receptionist', permissions: ['bill.view'] }, 'bill.view'), true);
  assert.equal(userCan({ role: 'receptionist', permissions: ['bill.view'] }, 'queue.confirm'), false);
  assert.equal(userCan({ role: 'receptionist' }, 'queue.confirm'), true);
  assert.equal(userCan(null, 'queue.confirm'), false);
  const mw = requirePermission('bill.view');
  assert.doesNotThrow(() => mw({ user: { role: 'receptionist', permissions: ['bill.view'] } }, {}, () => {}));
  assert.throws(() => mw({ user: { role: 'admin', permissions: [] } }, {}, () => {}));
});
