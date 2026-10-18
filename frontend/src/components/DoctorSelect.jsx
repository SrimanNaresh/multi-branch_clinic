// Doctor picker used before confirming a patient into the queue (a doctor is required).
// Picks the doctor automatically when the clinic has only one.
import { useEffect } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { useAsync } from './ui.jsx';

export default function DoctorSelect({ value, onChange, className = '' }) {
  const { t } = useT();
  const doctors = useAsync(() => api('/queue/doctors'), []);
  const rows = doctors.data?.rows || [];

  useEffect(() => {
    if (rows.length === 1 && !value) onChange(String(rows[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctors.data]);

  if (doctors.data && !rows.length) return <span className="field-error small">{t('queue.noDoctors')}</span>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('queue.assignDoctor')} required
      className={`doctor-select ${!value ? 'needs-value' : ''} ${className}`}>
      <option value="">{t('queue.selectDoctor')}</option>
      {rows.map((d) => <option key={d.id} value={d.id}>{d.name}{d.designation ? ` – ${d.designation}` : ''}</option>)}
    </select>
  );
}
