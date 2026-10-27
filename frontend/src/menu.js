// Sidebar menus. An item shows only if the user's role has its permission.
// `scope: 'main'`   → Main Clinic menu (Admin / Super Admin)
// `scope: 'branch'` → same for every clinic; admins see it once a clinic is selected
export const MENU = [
  {
    id: 'main', scope: 'main', label: 'menu.mainClinic',
    items: [
      { path: '/dashboard', label: 'menu.dashboard', perm: 'dashboard.view', icon: 'dashboard' },
      { path: '/employees/new', label: 'menu.employeeRegistration', perm: 'employee.create', icon: 'userPlus' },
      { path: '/employees', label: 'menu.allEmployees', perm: 'employee.create', icon: 'users' },
      { path: '/clinics', label: 'menu.clinicGeneration', perm: 'clinic.manage', icon: 'building' },
      { path: '/pharmacies', label: 'menu.pharmacyGeneration', perm: 'pharmacy.manage', icon: 'pill' },
      { path: '/labs', label: 'menu.labGeneration', perm: 'lab.manage', icon: 'flask' },
      { path: '/permissions', label: 'menu.menuPermission', perm: 'permission.manage', icon: 'key' },
    ],
  },
  {
    id: 'registration', scope: 'branch', label: 'menu.registration',
    items: [
      { path: '/patients/new', label: 'menu.patientRegistration', perm: 'patient.create', icon: 'userPlus' },
      { path: '/patients', label: 'menu.patientList', perm: 'patient.view', icon: 'list' },
      { path: '/clinic/employees/new', label: 'menu.employeeRegistration', perm: 'employee.create', icon: 'userPlus' },
      { path: '/clinic/employees', label: 'menu.employeeList', perm: 'employee.view', icon: 'users' },
    ],
  },
  {
    id: 'queue', scope: 'branch', label: 'menu.patientQueue',
    items: [
      { path: '/queue/confirm', label: 'menu.confirmSearch', perm: 'queue.confirm', icon: 'search' },
      { path: '/queue', label: 'menu.confirmList', perm: 'queue.view', icon: 'ticket' },
      { path: '/queue/tokens', label: 'menu.tokens', perm: 'queue.view', icon: 'clock' },
      { path: '/queue/consent', label: 'menu.consentForm', perm: 'patient.view', icon: 'file' },
    ],
  },
  {
    id: 'doctor', scope: 'branch', label: 'menu.doctor',
    items: [
      { path: '/doctor/examine', label: 'menu.examine', perm: 'visit.examine', icon: 'stethoscope' },
      { path: '/doctor/history', label: 'menu.patientHistory', perm: 'patient.history', icon: 'history' },
    ],
  },
  {
    id: 'pharmacy', scope: 'branch', label: 'menu.pharmacy',
    items: [
      { path: '/items/new', label: 'menu.item', perm: 'item.manage', icon: 'plus' },
      { path: '/items', label: 'menu.itemList', perm: 'item.view', icon: 'box' },
      { path: '/suppliers', label: 'menu.supplier', perm: 'supplier.manage', icon: 'truck' },
      { path: '/dispense', label: 'menu.dispense', perm: 'dispense', icon: 'pill' },
    ],
  },
  {
    id: 'billing', scope: 'branch', label: 'menu.billing',
    items: [
      { path: '/billing', label: 'menu.patientBill', perm: 'bill.create', icon: 'receipt' },
      { path: '/bills', label: 'menu.billList', perm: 'bill.view', icon: 'list' },
    ],
  },
  {
    id: 'communication', scope: 'branch', label: 'menu.communication',
    items: [
      { path: '/tickets', label: 'menu.tickets', perm: 'ticket.view', icon: 'message' },
    ],
  },
];

/** First page a user lands on after login. */
export function homePath(auth) {
  if (auth.can('dashboard.view')) return '/dashboard';
  for (const g of MENU) for (const i of g.items) if (g.scope === 'branch' && auth.can(i.perm)) return i.path;
  return '/profile';
}
