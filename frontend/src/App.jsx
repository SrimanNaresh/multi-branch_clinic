import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { LangProvider, useT } from './lib/i18n.jsx';
import { matchRoute, navigate, useLocation } from './lib/router.jsx';
import { ToastProvider, Loading, Empty } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { homePath } from './menu.js';

import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
// Main Clinic
import Dashboard from './pages/main/Dashboard.jsx';
import { ClinicsPage, PharmaciesPage, LabsPage } from './pages/main/Units.jsx';
import EmployeeForm from './pages/main/EmployeeForm.jsx';
import EmployeeList from './pages/main/EmployeeList.jsx';
import MenuPermissions from './pages/main/MenuPermissions.jsx';
// Branch clinic
import PatientForm from './pages/branch/PatientForm.jsx';
import PatientList from './pages/branch/PatientList.jsx';
import PatientView from './pages/branch/PatientView.jsx';
import ConfirmSearch from './pages/branch/ConfirmSearch.jsx';
import ConfirmList from './pages/branch/ConfirmList.jsx';
import Tokens from './pages/branch/Tokens.jsx';
import Examine from './pages/branch/Examine.jsx';
import PrescriptionPrint from './pages/branch/PrescriptionPrint.jsx';
import DayBookPrint from './pages/branch/DayBookPrint.jsx';
import ConsentForm from './pages/branch/ConsentForm.jsx';
import PatientHistory from './pages/branch/PatientHistory.jsx';
import ItemForm from './pages/branch/ItemForm.jsx';
import ItemList from './pages/branch/ItemList.jsx';
import SuppliersPage from './pages/branch/Suppliers.jsx';
import Dispense from './pages/branch/Dispense.jsx';
import PatientBill from './pages/branch/PatientBill.jsx';
import BillList from './pages/branch/BillList.jsx';
import BillView from './pages/branch/BillView.jsx';
import Tickets from './pages/branch/Tickets.jsx';

// branch: true → needs an active clinic (admins pick one in the switcher)
const ROUTES = [
  { path: '/dashboard', perm: 'dashboard.view', el: Dashboard },
  { path: '/clinics', perm: 'clinic.manage', el: ClinicsPage },
  { path: '/pharmacies', perm: 'pharmacy.manage', el: PharmaciesPage },
  { path: '/labs', perm: 'lab.manage', el: LabsPage },
  { path: '/employees', perm: 'employee.create', el: EmployeeList, props: { scope: 'main' } },
  { path: '/employees/new', perm: 'employee.create', el: EmployeeForm, props: { scope: 'main' } },
  { path: '/employees/:id/edit', perm: 'employee.edit', el: EmployeeForm, props: { scope: 'main' } },
  { path: '/permissions', perm: 'permission.manage', el: MenuPermissions },

  { path: '/patients/new', perm: 'patient.create', el: PatientForm, branch: true },
  { path: '/patients', perm: 'patient.view', el: PatientList, branch: true },
  { path: '/patients/:id', perm: 'patient.view', el: PatientView, branch: true },
  { path: '/patients/:id/edit', perm: 'patient.edit', el: PatientForm, branch: true },
  { path: '/clinic/employees', perm: 'employee.view', el: EmployeeList, props: { scope: 'branch' }, branch: true },
  { path: '/clinic/employees/new', perm: 'employee.create', el: EmployeeForm, props: { scope: 'branch' }, branch: true },
  { path: '/clinic/employees/:id/edit', perm: 'employee.edit', el: EmployeeForm, props: { scope: 'branch' }, branch: true },

  { path: '/queue/confirm', perm: 'queue.confirm', el: ConfirmSearch, branch: true },
  { path: '/queue', perm: 'queue.view', el: ConfirmList, branch: true },
  { path: '/queue/tokens', perm: 'queue.view', el: Tokens, branch: true },
  { path: '/queue/consent', perm: 'patient.view', el: ConsentForm, branch: true },
  { path: '/queue/consent/:patientId', perm: 'patient.view', el: ConsentForm, branch: true },

  { path: '/doctor/examine', perm: 'visit.examine', el: Examine, branch: true },
  { path: '/doctor/examine/:visitId', perm: 'visit.examine', el: Examine, branch: true },
  { path: '/doctor/prescription/:visitId', perm: 'patient.history', el: PrescriptionPrint, branch: true },
  { path: '/doctor/daybook/:visitId', perm: 'patient.history', el: DayBookPrint, branch: true },
  { path: '/doctor/history', perm: 'patient.history', el: PatientHistory, branch: true },
  { path: '/doctor/history/:patientId', perm: 'patient.history', el: PatientHistory, branch: true },

  { path: '/items/new', perm: 'item.manage', el: ItemForm, branch: true },
  { path: '/items', perm: 'item.view', el: ItemList, branch: true },
  { path: '/items/:id/edit', perm: 'item.manage', el: ItemForm, branch: true },
  { path: '/suppliers', perm: 'supplier.manage', el: SuppliersPage, branch: true },
  { path: '/dispense', perm: 'dispense', el: Dispense, branch: true },
  { path: '/dispense/:visitId', perm: 'dispense', el: Dispense, branch: true },

  { path: '/billing', perm: 'bill.create', el: PatientBill, branch: true },
  { path: '/billing/:visitId', perm: 'bill.create', el: PatientBill, branch: true },
  { path: '/bills', perm: 'bill.view', el: BillList, branch: true },
  { path: '/bills/:id', perm: ['bill.view', 'bill.create'], el: BillView, branch: true },

  { path: '/tickets', perm: 'ticket.view', el: Tickets, branch: true },

  { path: '/profile', el: Profile },
];

function Router() {
  const auth = useAuth();
  const { t } = useT();
  const { path, query } = useLocation();

  useEffect(() => {
    if (auth.user && (path === '/' || path === '/login')) navigate(homePath(auth), { replace: true });
  }, [auth, path]);

  if (auth.loading) return <div className="center-screen"><Loading /></div>;
  if (!auth.user) return <Login />;

  let route = null;
  let params = {};
  for (const r of ROUTES) {
    const m = matchRoute(r.path, path);
    if (m) { route = r; params = m; break; }
  }

  let page;
  if (!route) {
    page = <Empty>{t('common.pageNotFound')}</Empty>;
  } else if (route.perm && ![].concat(route.perm).some((p) => auth.can(p))) {
    page = <Empty>{t('common.noAccess')}</Empty>;
  } else if (route.branch && !auth.activeClinic) {
    page = <Empty>{t('nav.selectClinicFirst')}</Empty>;
  } else {
    const El = route.el;
    // key: remount the page when the admin switches clinic, so it reloads that clinic's data
    page = <El key={`${auth.activeClinicId}|${path}`} params={params} query={query} {...(route.props || {})} />;
  }
  return <Layout path={path}>{page}</Layout>;
}

// The built page loads one hashed bundle (assets/index-<hash>.js). A tab left open keeps running the old
// bundle after an update, so check index.html every minute and offer a reload when the bundle changed.
const bundleOf = (html) => html.match(/assets\/index-[\w-]+\.js/)?.[0] || null;

function UpdateBanner() {
  const { t } = useT();
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const current = bundleOf(document.documentElement.innerHTML);
    if (!current) return undefined;   // Vite dev server: no bundle to compare
    const check = async () => {
      try {
        const res = await fetch(window.location.pathname, { cache: 'no-store' });
        const latest = bundleOf(await res.text());
        if (latest && latest !== current) setStale(true);
      } catch { /* offline – try again next time */ }
    };
    const h = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { clearInterval(h); window.removeEventListener('focus', check); };
  }, []);
  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t('app.updateAvailable')}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>{t('app.reload')}</button>
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <UpdateBanner />
      <ToastProvider>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </ToastProvider>
    </LangProvider>
  );
}
