import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function EmployeeList({ scope }) {
  const { t } = useT();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [clinicFilter, setClinicFilter] = useState(scope === 'main' ? 'all' : '');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  const base = scope === 'main' ? '/employees' : '/clinic/employees';
  const query = { q: dq, role, page, ...(scope === 'main' ? { clinic_id: clinicFilter } : {}) };
  const list = useAsync(() => api('/employees', { query, clinic: scope === 'main' ? null : undefined }), [dq, role, page, clinicFilter]);

  const unitLabel = (r) => (r.unit_type === 'pharmacy' ? r.pharmacy_name : r.unit_type === 'lab' ? r.lab_name : r.unit_type === 'main' ? t('unit.main') : t('unit.clinic'));
  const columns = [
    { key: 'emp_code', label: t('field.code'), render: (r) => <b>{r.emp_code}</b> },
    { key: 'name', label: t('field.name') },
    { key: 'role', label: t('field.role'), render: (r) => t(`role.${r.role}`) },
    ...(scope === 'main' ? [{ key: 'clinic_name', label: t('field.clinic'), render: (r) => r.clinic_name ? `${r.clinic_name} (${r.clinic_code})` : t('unit.main') }] : []),
    { key: 'unit', label: t('employees.workUnit'), render: unitLabel },
    { key: 'mobile', label: t('field.mobile') },
    { key: 'username', label: t('login.username'), render: (r) => (r.can_login ? r.username : <span className="muted">{t('employees.noLogin')}</span>) },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
    ...(auth.can('employee.edit') ? [{
      key: '_e', label: '', className: 'col-actions',
      render: (r) => (['admin', 'super_admin'].includes(r.role) && auth.user.role !== 'super_admin') ? null : (
        <Button size="sm" variant="ghost" onClick={() => navigate(`${base}/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader
        title={scope === 'main' ? t('menu.allEmployees') : t('menu.employeeList')}
        subtitle={scope === 'branch' ? auth.activeClinic?.name : undefined}
        actions={auth.can('employee.create') && <Button onClick={() => navigate(`${base}/new`)}><Icon name="plus" size={16} /> {t('menu.employeeRegistration')}</Button>}
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('employees.searchHint')} />
          <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label={t('field.role')}>
            <option value="">{t('employees.allRoles')}</option>
            {['super_admin', 'admin', 'receptionist', 'doctor', 'pharmacist', 'billing'].map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
          {scope === 'main' && (
            <select value={clinicFilter} onChange={(e) => { setClinicFilter(e.target.value); setPage(1); }} aria-label={t('field.clinic')}>
              <option value="all">{t('topbar.allClinics')}</option>
              <option value="main">{t('unit.main')}</option>
              {auth.clinics.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          )}
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
