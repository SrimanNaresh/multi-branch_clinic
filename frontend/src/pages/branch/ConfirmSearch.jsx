// Confirm & Search: find a patient by name / mobile / ID and confirm into today's queue
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, SearchBox, StatusBadge, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsModal } from '../../components/VitalSigns.jsx';
import DoctorSelect from '../../components/DoctorSelect.jsx';

export default function ConfirmSearch() {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [doctorId, setDoctorId] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [last, setLast] = useState(null);
  const [vitalsFor, setVitalsFor] = useState(null);   // queue entry whose vital signs are open

  const results = useAsync(() => (dq.trim() ? api('/queue/search', { query: { q: dq.trim() } }) : Promise.resolve({ rows: [] })), [dq]);

  async function confirm(p) {
    if (!doctorId) { toast(t('queue.doctorRequired'), 'error'); return; }
    setBusyId(p.id);
    try {
      const entry = await api('/queue', {
        method: 'POST',
        body: { patient_id: p.id, visit_type: p.last_visit ? 'follow_up' : 'new', doctor_id: doctorId },
      });
      setLast(entry);
      toast(t('queue.confirmed', { n: entry.token_no, name: p.name }));
      results.reload();
      if (auth.can('vitals.record')) setVitalsFor(entry);   // next step: vital signs
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title={t('menu.confirmSearch')} subtitle={t('queue.searchSubtitle')}
        actions={<Button variant="ghost" onClick={() => navigate('/queue')}><Icon name="ticket" size={16} /> {t('menu.confirmList')}</Button>} />

      {last && (
        <div className="token-banner">
          <div className="token-big">{last.token_no}</div>
          <div>
            <strong>{last.patient_name}</strong>
            <span className="muted">{last.patient_code} · {t('queue.tokenIssued')}</span>
          </div>
          {auth.can('vitals.record') && (
            <Button variant="ghost" size="sm" onClick={() => setVitalsFor(last)}>
              <Icon name="stethoscope" size={15} /> {last.vitals_id ? t('vitals.edit') : t('vitals.title')}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="banner-close" onClick={() => setLast(null)}>×</Button>
        </div>
      )}

      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t('queue.searchHint')} autoFocus />
          <DoctorSelect value={doctorId} onChange={setDoctorId} />
        </div>
        <ErrorBox error={results.error} />
        {!dq.trim() ? (
          <Empty>{t('queue.typeToSearch')}</Empty>
        ) : results.loading && !results.data ? <Loading /> : results.data?.rows.length === 0 ? (
          <Empty>
            {t('queue.noMatch')}{' '}
            {auth.can('patient.create') && <Button size="sm" onClick={() => navigate('/patients/new')}>{t('menu.patientRegistration')}</Button>}
          </Empty>
        ) : (
          <ul className="result-list">
            {results.data?.rows.map((p) => (
              <li key={p.id}>
                <div className="result-main">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.patient_code} · {p.mobile} · {genderLabel(p.gender, t)} / {ageLabel(p)}{p.city ? ` · ${p.city}` : ''}</span>
                  <span className="muted small">{p.last_visit ? `${t('patients.lastVisit')} ${fmtDate(p.last_visit)}` : t('queue.firstVisit')}</span>
                </div>
                {p.queue_id ? (
                  <div className="result-side">
                    <span className="token-chip">#{p.token_no}</span>
                    <StatusBadge status={p.queue_status} />
                    {auth.can('vitals.record') && (
                      <Button size="sm" variant="ghost" onClick={() => setVitalsFor({ id: p.queue_id, token_no: p.token_no, patient_name: p.name })}>
                        {t('vitals.title')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button onClick={() => confirm(p)} loading={busyId === p.id} disabled={!doctorId}
                    title={!doctorId ? t('queue.doctorRequired') : undefined}>{t('queue.confirm')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {vitalsFor && (
        <VitalsModal entry={vitalsFor} onClose={() => setVitalsFor(null)}
          onSaved={(v) => setLast((l) => (l && l.id === vitalsFor.id ? { ...l, vitals_id: v.id } : l))} />
      )}
    </>
  );
}
