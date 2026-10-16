// Confirm & Search: find a patient by name / mobile / ID and confirm into today's queue
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, SearchBox, StatusBadge, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function ConfirmSearch() {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [doctorId, setDoctorId] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [last, setLast] = useState(null);

  const doctors = useAsync(() => api('/queue/doctors'), []);
  const results = useAsync(() => (dq.trim() ? api('/queue/search', { query: { q: dq.trim() } }) : Promise.resolve({ rows: [] })), [dq]);

  async function confirm(p) {
    setBusyId(p.id);
    try {
      const entry = await api('/queue', {
        method: 'POST',
        body: { patient_id: p.id, visit_type: p.last_visit ? 'follow_up' : 'new', doctor_id: doctorId || undefined },
      });
      setLast(entry);
      toast(t('queue.confirmed', { n: entry.token_no, name: p.name }));
      results.reload();
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
          <Button variant="ghost" size="sm" onClick={() => setLast(null)}>×</Button>
        </div>
      )}

      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t('queue.searchHint')} autoFocus />
          {doctors.data?.rows?.length > 0 && (
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label={t('queue.assignDoctor')}>
              <option value="">{t('queue.anyDoctor')}</option>
              {doctors.data.rows.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
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
                  </div>
                ) : (
                  <Button onClick={() => confirm(p)} loading={busyId === p.id}>{t('queue.confirm')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
