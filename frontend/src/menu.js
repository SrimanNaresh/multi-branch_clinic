// Sidebar menus. An item shows only if the user's role has its permission.
// `scope: 'main'`   → Main Clinic menu (Admin / Super Admin)
// `scope: 'branch'` → same for every clinic; admins see it once a clinic is selected
// A sub-menu (sub(...)) has `children` instead of a path; it shows if any child is allowed.

const sub = (id, label, icon, children) => ({ id, label, icon, children });

/** Every page link of a group, sub-menu children included. */
export const menuLinks = (items) => items.flatMap((i) => i.children || [i]);

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
    // each entry opens into its own Master (add) / List pages
    items: [
      sub('item', 'menu.itemGroup', 'box', [
        { path: '/items/new', label: 'menu.itemMaster', perm: 'item.manage' },
        { path: '/items', label: 'menu.pharmacyList', perm: 'item.view' },
        { path: '/items/bulk', label: 'menu.bulkUpdate', perm: 'item.manage' },
      ]),
      sub('vendor', 'menu.vendor', 'truck', [
        { path: '/suppliers/new', label: 'menu.itemMaster', perm: 'supplier.manage' },
        { path: '/suppliers', label: 'menu.pharmacyList', perm: 'supplier.manage' },
      ]),
      sub('purchase', 'menu.purchase', 'receipt', [
        { path: '/purchase/new', label: 'menu.itemMaster', perm: 'stock.manage' },
        { path: '/purchase', label: 'menu.pharmacyList', perm: 'stock.manage' },
      ]),
      sub('stockin', 'menu.stockIn', 'download', [
        { path: '/stock-in/new', label: 'menu.itemMaster', perm: 'stock.manage' },
        { path: '/stock-in', label: 'menu.pharmacyList', perm: 'stock.manage' },
      ]),
      sub('return', 'menu.return', 'upload', [
        { path: '/returns/new', label: 'menu.itemMaster', perm: 'stock.manage' },
        { path: '/returns', label: 'menu.pharmacyList', perm: 'stock.manage' },
      ]),
      sub('sales', 'menu.sales', 'pill', [
        { path: '/sales/new', label: 'menu.itemMaster', perm: 'dispense' },
        { path: '/sales', label: 'menu.pharmacyList', perm: 'dispense' },
        { path: '/dispense', label: 'menu.dispense', perm: 'dispense' },   // medicines from a prescription
      ]),
      sub('report', 'menu.report', 'file', [
        { path: '/reports/stock', label: 'menu.stockReport', perm: 'item.view' },
        { path: '/reports/vendor-payments', label: 'menu.vendorPayments', perm: 'stock.manage' },
      ]),
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
  for (const g of MENU) for (const i of menuLinks(g.items)) if (g.scope === 'branch' && auth.can(i.perm)) return i.path;
  return '/profile';
}
