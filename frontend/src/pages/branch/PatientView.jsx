import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, Card, ErrorBox, Loading, PageHeader, StatusBadge, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function PatientView({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data: p, error, loading } = useAsync(() => api(`/patients/${params.id}`), [params.id]);

  async function addToQueue() {
    setBusy(true);
    try {
      const q = await api('/queue', { method: 'POST', body: { patient_id: p.id, visit_type: p.visit_count ? 'follow_up' : 'new' } });
      toast(t('queue.confirmed', { n: q.token_no, name: p.name }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const rows = [
    [t('field.patientId'), p.patient_code],
    [t('field.mobile'), p.mobile],
    [t('field.altMobile'), p.alt_mobile],
    [t('field.genderAge'), `${genderLabel(p.gender, t)} / ${ageLabel(p)}`],
    [t('field.dob'), p.dob ? fmtDate(p.dob) : null],
    [t('field.bloodGroup'), p.blood_group],
    [t('field.email'), p.email],
    [t('field.occupation'), p.occupation],
    [t('field.address'), [p.address, p.city].filter(Boolean).join(', ')],
    [t('field.notes'), p.notes],
    [t('patients.registeredOn'), fmtDate(p.created_at, true)],
    [t('patients.visits'), `${p.visit_count}${p.last_visit ? ` · ${t('patients.lastVisit')} ${fmtDate(p.last_visit)}` : ''}`],
  ];

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={<>{p.patient_code} · <StatusBadge status={p.status} /></>}
        actions={(
          <>
            {auth.can('queue.confirm') && <Button onClick={addToQueue} loading={busy}><Icon name="ticket" size={16} /> {t('queue.addToQueue')}</Button>}
            {auth.can('patient.history') && <Button variant="ghost" onClick={() => navigate(`/doctor/history/${p.id}`)}><Icon name="history" size={16} /> {t('menu.patientHistory')}</Button>}
            {auth.can('patient.edit') && <Button variant="ghost" onClick={() => navigate(`/patients/${p.id}/edit`)}><Icon name="edit" size={16} /> {t('common.edit')}</Button>}
          </>
        )}
      />
      <Card>
        <dl className="details">
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </Card>
    </>
  );
}
