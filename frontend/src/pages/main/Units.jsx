// Clinic Generation, Pharmacy Generation, Lab Generation
import { useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { money } from '../../lib/format.js';
import CrudPage, { statusColumn } from '../../components/CrudPage.jsx';

export function ClinicsPage() {
  const { t } = useT();
  const { reloadClinics } = useAuth();
  return (
      <CrudPage
        onSaved={reloadClinics}
        title={t('menu.clinicGeneration')}
        subtitle={t('clinics.subtitle')}
        endpoint="/clinics"
        clinic={null}
        addLabel={t('clinics.add')}
        fields={[
          { name: 'name', label: t('field.clinicName'), required: true },
          { name: 'code', label: t('field.code'), required: true, upper: true, maxLength: 10, hint: t('clinics.codeHint') },
          { name: 'phone', label: t('field.phone'), type: 'tel' },
          { name: 'email', label: t('field.email'), type: 'email' },
          { name: 'city', label: t('field.city') },
          { name: 'consultation_fee', label: t('field.consultationFee'), type: 'number' },
          { name: 'address', label: t('field.address'), type: 'textarea', full: true },
        ]}
        columns={[
          { key: 'code', label: t('field.code'), render: (r) => <b>{r.code}</b> },
          { key: 'name', label: t('field.clinicName') },
          { key: 'city', label: t('field.city') },
          { key: 'phone', label: t('field.phone') },
          { key: 'consultation_fee', label: t('field.consultationFee'), render: (r) => money(r.consultation_fee) },
          { key: 'units', label: t('clinics.units'), render: (r) => `${r.pharmacy_count} / ${r.lab_count} / ${r.employee_count}` },
          statusColumn(t),
        ]}
      />
  );
}

function UnitPage({ kind }) {
  const { t } = useT();
  const { clinics } = useAuth();
  const [clinicFilter, setClinicFilter] = useState('');
  const clinicOptions = clinics.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }));
  const isPharmacy = kind === 'pharmacy';

  return (
    <CrudPage
      title={t(isPharmacy ? 'menu.pharmacyGeneration' : 'menu.labGeneration')}
      subtitle={t(isPharmacy ? 'pharmacies.subtitle' : 'labs.subtitle')}
      endpoint={isPharmacy ? '/pharmacies' : '/labs'}
      clinic={null}
      addLabel={t(isPharmacy ? 'pharmacies.add' : 'labs.add')}
      extraQuery={{ clinic_id: clinicFilter }}
      filters={(
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} aria-label={t('field.clinic')}>
          <option value="">{t('topbar.allClinics')}</option>
          {clinicOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      defaults={{ clinic_id: clinicFilter }}
      fields={[
        { name: 'clinic_id', label: t('field.linkedClinic'), type: 'select', required: true, options: clinicOptions },
        { name: 'name', label: t(isPharmacy ? 'field.pharmacyName' : 'field.labName'), required: true },
        { name: 'code', label: t('field.code'), required: true, upper: true, maxLength: 10 },
        { name: 'phone', label: t('field.phone'), type: 'tel' },
        ...(isPharmacy ? [{ name: 'license_no', label: t('field.licenseNo') }] : []),
        { name: 'address', label: t('field.address'), type: 'textarea', full: true },
      ]}
      columns={[
        { key: 'code', label: t('field.code'), render: (r) => <b>{r.code}</b> },
        { key: 'name', label: t(isPharmacy ? 'field.pharmacyName' : 'field.labName') },
        { key: 'clinic_name', label: t('field.linkedClinic'), render: (r) => `${r.clinic_name} (${r.clinic_code})` },
        { key: 'phone', label: t('field.phone') },
        statusColumn(t),
      ]}
    />
  );
}

export const PharmaciesPage = () => <UnitPage kind="pharmacy" />;
export const LabsPage = () => <UnitPage kind="lab" />;
