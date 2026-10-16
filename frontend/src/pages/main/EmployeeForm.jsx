// Employee Registration – used from the Main Clinic menu (any clinic / pharmacy / lab)
// and from the branch Registration menu (fixed to the active clinic).
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, PageHeader, Select, TextArea, useAsync, useForm, useToast } from '../../components/ui.jsx';

const BRANCH_ROLES = ['receptionist', 'doctor', 'pharmacist', 'billing'];

export default function EmployeeForm({ scope, params }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const id = params.id;
  const listPath = scope === 'main' ? '/employees' : '/clinic/employees';

  const f = useForm({
    name: '', gender: '', dob: '', mobile: '', email: '', designation: '', qualification: '', address: '', join_date: '',
    role: 'receptionist', unit_type: 'clinic',
    clinic_id: scope === 'branch' ? auth.activeClinicId : (auth.activeClinicId || ''),
    pharmacy_id: '', lab_id: '', can_login: true, username: '', password: '', status: 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const units = useAsync(async () => {
    const [ph, lb] = await Promise.all([api('/pharmacies', { clinic: null }), api('/labs', { clinic: null })]);
    return { pharmacies: ph.rows, labs: lb.rows };
  }, []);
  const existing = useAsync(() => (id ? api(`/employees/${id}`, { clinic: null }) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    f.setValues((v) => ({
      ...v,
      ...Object.fromEntries(Object.keys(v).map((k) => [k, e[k] ?? v[k]])),
      clinic_id: e.clinic_id ? String(e.clinic_id) : '',
      pharmacy_id: e.pharmacy_id ? String(e.pharmacy_id) : '',
      lab_id: e.lab_id ? String(e.lab_id) : '',
      dob: e.dob || '', join_date: e.join_date || '',
      can_login: !!e.can_login, username: e.username || '', password: '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const v = f.values;
  const globalRole = v.role === 'admin' || v.role === 'super_admin';
  const roleOptions = [
    ...(scope === 'main' && auth.user.role === 'super_admin' ? ['super_admin', 'admin'] : []),
    ...(existing.data && ['admin', 'super_admin'].includes(existing.data.role) && auth.user.role !== 'super_admin' ? [existing.data.role] : []),
    ...BRANCH_ROLES,
  ].map((r) => ({ value: r, label: t(`role.${r}`) }));

  const clinicOptions = auth.clinics.filter((c) => c.status === 'active' || String(c.id) === String(v.clinic_id))
    .map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }));
  const pharmacyOptions = (units.data?.pharmacies || []).filter((p) => !v.clinic_id || String(p.clinic_id) === String(v.clinic_id))
    .map((p) => ({ value: String(p.id), label: `${p.name} (${p.code})` }));
  const labOptions = (units.data?.labs || []).filter((l) => !v.clinic_id || String(l.clinic_id) === String(v.clinic_id))
    .map((l) => ({ value: String(l.id), label: `${l.name} (${l.code})` }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { ...v };
    if (globalRole) Object.assign(body, { unit_type: 'main', clinic_id: null, pharmacy_id: null, lab_id: null });
    if (body.unit_type !== 'pharmacy') body.pharmacy_id = null;
    if (body.unit_type !== 'lab') body.lab_id = null;
    if (!body.password) delete body.password;
    if (!body.can_login) { delete body.password; }
    try {
      const saved = id
        ? await api(`/employees/${id}`, { method: 'PUT', body, clinic: null })
        : await api('/employees', { method: 'POST', body, clinic: null });
      toast(t('employees.saved', { code: saved.emp_code }));
      navigate(listPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;

  return (
    <>
      <PageHeader
        title={id ? `${t('common.edit')} – ${existing.data?.name}` : t('menu.employeeRegistration')}
        subtitle={id ? existing.data?.emp_code : scope === 'branch' ? auth.activeClinic?.name : t('employees.subtitle')}
      />
      <form onSubmit={submit}>
        <Card title={t('employees.assignment')}>
          <div className="form-grid">
            <Select label={t('field.role')} required value={v.role} onChange={(e) => f.set('role', e.target.value)} options={roleOptions} />
            {!globalRole && (
              <Select label={t('employees.workUnit')} required value={v.unit_type}
                onChange={(e) => f.set('unit_type', e.target.value)}
                options={['clinic', 'pharmacy', 'lab'].map((u) => ({ value: u, label: t(`unit.${u}`) }))} />
            )}
            {!globalRole && (scope === 'main' ? (
              <Select label={t('field.clinic')} required value={v.clinic_id} placeholder="—"
                onChange={(e) => f.setValues((x) => ({ ...x, clinic_id: e.target.value, pharmacy_id: '', lab_id: '' }))} options={clinicOptions} />
            ) : (
              <Input label={t('field.clinic')} value={`${auth.activeClinic?.name} (${auth.activeClinic?.code})`} disabled />
            ))}
            {!globalRole && v.unit_type === 'pharmacy' && (
              <Select label={t('unit.pharmacy')} required value={v.pharmacy_id} placeholder="—" onChange={(e) => f.set('pharmacy_id', e.target.value)}
                options={pharmacyOptions} hint={!pharmacyOptions.length ? t('employees.noPharmacy') : undefined} />
            )}
            {!globalRole && v.unit_type === 'lab' && (
              <Select label={t('unit.lab')} required value={v.lab_id} placeholder="—" onChange={(e) => f.set('lab_id', e.target.value)}
                options={labOptions} hint={!labOptions.length ? t('employees.noLab') : undefined} />
            )}
            {globalRole && <p className="muted field-full">{t('employees.globalNote')}</p>}
          </div>
        </Card>

        <Card title={t('employees.personal')}>
          <div className="form-grid">
            <Input label={t('field.name')} required {...f.bind('name')} />
            <Select label={t('field.gender')} {...f.bind('gender')} placeholder="—"
              options={['M', 'F', 'O'].map((g) => ({ value: g, label: t(`gender.${g}`) }))} />
            <Input label={t('field.mobile')} type="tel" {...f.bind('mobile')} />
            <Input label={t('field.email')} type="email" {...f.bind('email')} />
            <Input label={t('field.dob')} type="date" {...f.bind('dob')} />
            <Input label={t('field.joinDate')} type="date" {...f.bind('join_date')} />
            <Input label={t('field.designation')} {...f.bind('designation')} />
            <Input label={t('field.qualification')} {...f.bind('qualification')} />
            <TextArea label={t('field.address')} rows={2} {...f.bind('address')} />
          </div>
        </Card>

        <Card title={t('employees.login')}>
          <div className="form-grid">
            <label className="check field-full">
              <input type="checkbox" checked={!!v.can_login} onChange={(e) => f.set('can_login', e.target.checked)} />
              {t('employees.canLogin')}
            </label>
            {v.can_login && (
              <>
                <Input label={t('login.username')} required={!id || !existing.data?.username} autoComplete="off" {...f.bind('username')} />
                <Input label={t('login.password')} type="password" autoComplete="new-password" minLength={6}
                  required={!id} hint={id ? t('employees.passwordKeep') : t('employees.passwordMin')} {...f.bind('password')} />
              </>
            )}
            <Select label={t('field.status')} {...f.bind('status')}
              options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
          </div>
        </Card>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={() => navigate(listPath)}>{t('common.cancel')}</Button>
          <Button type="submit" loading={saving}>{id ? t('common.save') : t('employees.register')}</Button>
        </div>
      </form>
    </>
  );
}
