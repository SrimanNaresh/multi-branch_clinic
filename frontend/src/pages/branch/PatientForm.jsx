import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, PageHeader, Select, TextArea, useAsync, useForm, useToast } from '../../components/ui.jsx';

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function PatientForm({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const id = params.id;
  const f = useForm({
    name: '', gender: '', age_years: '', dob: '', mobile: '', alt_mobile: '', email: '',
    address: '', blood_group: '', notes: '', status: 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const existing = useAsync(() => (id ? api(`/patients/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    if (!existing.data) return;
    f.setValues((v) => Object.fromEntries(Object.keys(v).map((k) => [k, existing.data[k] ?? ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  async function save(force = false) {
    setSaving(true);
    setError('');
    try {
      const body = { ...f.values, force };
      const p = id
        ? await api(`/patients/${id}`, { method: 'PUT', body })
        : await api('/patients', { method: 'POST', body });
      toast(id ? t('common.saved') : t('patients.registered', { code: p.patient_code }));
      navigate(`/patients/${p.id}`);
    } catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE') setDuplicate(err.details || []);
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;

  return (
    <>
      <PageHeader
        title={id ? `${t('common.edit')} – ${existing.data?.name}` : t('menu.patientRegistration')}
        subtitle={id ? existing.data?.patient_code : t('patients.idHint', { code: `${auth.activeClinic?.code}-0001` })}
      />
      <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <Card>
          <div className="form-grid patient-grid">
            <Input label={t('field.name')} required {...f.bind('name')} autoFocus={!id} />
            <Input label={t('field.age')} type="number" min="0" max="130" {...f.bind('age_years')} />
            <div className="field">
              <span className="field-label">{t('field.gender')}</span>
              <div className="gender-checks">
                {['M', 'F', 'O'].map((g) => (
                  <label key={g}>
                    <input type="radio" name="gender" value={g} checked={f.values.gender === g}
                      onChange={() => f.set('gender', g)} />
                    {t(`gender.${g}`)}
                  </label>
                ))}
              </div>
            </div>
            <Input label={t('field.dob')} type="date" {...f.bind('dob')} />
            <Select label={t('field.bloodGroup')} {...f.bind('blood_group')} placeholder="—" options={BLOOD.map((b) => ({ value: b, label: b }))} />
            {/* Address shares one row with Mobile, Alternate mobile and Email (styles: .patient-grid) */}
            <TextArea label={t('field.address')} rows={1} {...f.bind('address')} />
            <Input label={t('field.mobile')} type="tel" required inputMode="tel" {...f.bind('mobile')} />
            <Input label={t('field.altMobile')} type="tel" {...f.bind('alt_mobile')} />
            <Input label={t('field.email')} type="email" {...f.bind('email')} />
            <TextArea label={t('field.notes')} rows={2} {...f.bind('notes')} />
            {id && (
              <Select label={t('field.status')} {...f.bind('status')}
                options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
            )}
          </div>
        </Card>
        {duplicate && (
          <div className="alert alert-warning">
            <div>
              <b>{t('patients.possibleDuplicate')}</b>
              <ul>{duplicate.map((d) => <li key={d.id}><a href={`#/patients/${d.id}`}>{d.patient_code} – {d.name} ({d.mobile})</a></li>)}</ul>
            </div>
            <Button type="button" variant="ghost" onClick={() => save(true)} loading={saving}>{t('patients.registerAnyway')}</Button>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={() => window.history.back()}>{t('common.cancel')}</Button>
          <Button type="submit" loading={saving}>{id ? t('common.save') : t('patients.register')}</Button>
        </div>
      </form>
    </>
  );
}
