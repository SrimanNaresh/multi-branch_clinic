// Single source of truth for roles and permissions.
// Imported by the backend (enforcement) and the frontend (hiding menus).
// Change access for a role here and both sides follow.

export const ROLES = ['super_admin', 'admin', 'receptionist', 'doctor', 'pharmacist', 'billing'];

// Global roles work across all clinics (clinic_id NULL) and have every permission.
export const GLOBAL_ROLES = ['super_admin', 'admin'];

// Permissions only global roles hold (never listed below):
//   dashboard.view, clinic.manage, pharmacy.manage, lab.manage,
//   employee.create, employee.edit, patient.create, bill.cancel
export const ROLE_PERMISSIONS = {
  receptionist: [
    'patient.view', 'patient.edit',
    'employee.view',
    'queue.confirm', 'queue.view', 'queue.update',
  ],
  doctor: [
    'patient.view', 'patient.history',
    'queue.view', 'queue.update',
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
