// Single source of truth for roles and permissions.
// Imported by the backend (enforcement) and the frontend (hiding menus).
// Change access for a role here and both sides follow.

export const ROLES = ['super_admin', 'admin', 'receptionist', 'doctor', 'pharmacist', 'billing'];

// Global roles work across all clinics (clinic_id NULL) and have every permission.
export const GLOBAL_ROLES = ['super_admin', 'admin'];

// Permissions only global roles hold by default (never listed below):
//   dashboard.view, clinic.manage, pharmacy.manage, lab.manage, permission.manage,
//   employee.create, employee.edit, patient.create, bill.cancel
// Main Clinic → Menu Permission can add or remove permissions per employee (see the end of this file).
export const ROLE_PERMISSIONS = {
  receptionist: [
    'patient.view', 'patient.edit',
    'employee.view',
    'queue.confirm', 'queue.view', 'queue.update', 'vitals.record',
  ],
  doctor: [
    'patient.view', 'patient.history',
    'queue.view', 'queue.update', 'vitals.record',
    'visit.examine',
    'item.view',
  ],
  pharmacist: [
    'patient.view',
    'item.view', 'item.manage', 'stock.manage', 'supplier.manage',
    'dispense',
  ],
  billing: [
    'patient.view',
    'queue.view',
    'bill.create', 'bill.view',
  ],
};

export function isGlobalRole(role) {
  return GLOBAL_ROLES.includes(role);
}

export function can(role, permission) {
  if (isGlobalRole(role)) return true;
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

export function canAny(role, permissions) {
  return permissions.some((p) => can(role, p));
}

/* ---------- user-wise access (Main Clinic → Menu Permission) ----------
   Each employee starts with their role's permissions; Menu Permission stores only
   the differences (granted / removed) per employee. Super Admin always has everything. */

// Every permission, grouped like the sidebar menus (labels: perm.<key>, menu groups: menu.<group label>)
export const PERMISSION_GROUPS = [
  { id: 'main', label: 'menu.mainClinic', perms: ['dashboard.view', 'employee.create', 'employee.edit', 'clinic.manage', 'pharmacy.manage', 'lab.manage', 'permission.manage'] },
  { id: 'registration', label: 'menu.registration', perms: ['patient.create', 'patient.view', 'patient.edit', 'employee.view'] },
  { id: 'queue', label: 'menu.patientQueue', perms: ['queue.confirm', 'queue.view', 'queue.update', 'vitals.record'] },
  { id: 'doctor', label: 'menu.doctor', perms: ['visit.examine', 'patient.history'] },
  { id: 'pharmacy', label: 'menu.pharmacy', perms: ['item.manage', 'item.view', 'stock.manage', 'supplier.manage', 'dispense'] },
  { id: 'billing', label: 'menu.billing', perms: ['bill.create', 'bill.view', 'bill.cancel'] },
];
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms);

// Main-office powers: these work across all clinics, so branch staff can never be given them.
export const GLOBAL_ONLY_PERMISSIONS = ['dashboard.view', 'employee.create', 'employee.edit', 'clinic.manage', 'pharmacy.manage', 'lab.manage', 'permission.manage'];

/** The permissions a role starts with. */
export function rolePermissions(role) {
  if (isGlobalRole(role)) return [...ALL_PERMISSIONS];
  return [...(ROLE_PERMISSIONS[role] || [])];
}

/** Permissions this role may hold at all (used to validate Menu Permission changes). */
export function grantablePermissions(role) {
  if (role === 'super_admin') return [];                   // always everything, never edited
  if (isGlobalRole(role)) return [...ALL_PERMISSIONS];
  return ALL_PERMISSIONS.filter((p) => !GLOBAL_ONLY_PERMISSIONS.includes(p));
}

/**
 * Effective permissions of one employee.
 * @param overrides [{ permission, granted }] rows from employee_permissions
 */
export function effectivePermissions(role, overrides = []) {
  const set = new Set(rolePermissions(role));
  if (role === 'super_admin') return [...set];
  const allowed = new Set(grantablePermissions(role));
  for (const o of overrides) {
    if (o.granted && allowed.has(o.permission)) set.add(o.permission);
    else if (!o.granted) set.delete(o.permission);
  }
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

/** Overrides needed to turn the role's defaults into exactly `wanted`. */
export function overridesFor(role, wanted) {
  const base = new Set(rolePermissions(role));
  const want = new Set(wanted);
  return ALL_PERMISSIONS.flatMap((p) => {
    if (want.has(p) && !base.has(p)) return [{ permission: p, granted: true }];
    if (!want.has(p) && base.has(p)) return [{ permission: p, granted: false }];
    return [];
  });
}

/** Permission check for a logged-in user ({ role, permissions? }); falls back to the role when no list is loaded. */
export function userCan(user, permission) {
  if (!user) return false;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  return can(user.role, permission);
}
