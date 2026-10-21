// Doctor → Patient History: all previous visits and prescriptions
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel, money } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, SearchBox, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import { vitalsSummary } from '../../components/VitalSigns.jsx';
import Icon from '../../components/Icon.jsx';
import { DosDontSummary } from '../../components/DosDontList.jsx';
import { pastHistoryLine } from '../../components/PastHistoryList.jsx';

function PatientSearch() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useAsync(() => (dq.trim() ? api('/patients', { query: { q: dq.trim(), limit: 20 } }) : Promise.resolve({ rows: [] })), [dq]);
  return (
    <Card>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder={t('patients.searchHint')} autoFocus /></div>
      {!dq.trim() ? <Empty>{t('queue.typeToSearch')}</Empty> : r.loading && !r.data ? <Loading /> : (
        <ul className="result-list">
          {r.data?.rows.map((p) => (
            <li key={p.id}>
              <div className="result-main">
                <strong>{p.name}</strong>
                <span className="muted">{p.patient_code} · {p.mobile} · {genderLabel(p.gender, t)} / {ageLabel(p)}</span>
              </div>
              <Button variant="ghost" onClick={() => navigate(`/doctor/history/${p.id}`)}>{t('history.open')}</Button>
            </li>
          ))}
          {r.data?.rows.length === 0 && <Empty>{t('queue.noMatch')}</Empty>}
        </ul>
      )}
    </Card>
  );
}

function Vitals({ v, visit }) {
  const { t } = useT();
  if (visit?.vitals_id) {
    const line = [vitalsSummary(visit, t), visit.vitals_comments].filter(Boolean).join(' · ');
    return line ? <p className="muted small">{line}</p> : null;
  }
  if (!v) return null;
  const parts = [
    v.bp && `${t('examine.bp')} ${v.bp}`, v.pulse && `${t('examine.pulse')} ${v.pulse}`,
    v.temp && `${t('examine.temp')} ${v.temp}`, v.weight && `${t('examine.weight')} ${v.weight}`,
  ].filter(Boolean);
  return parts.length ? <p className="muted small">{parts.join(' · ')}</p> : null;
}

export default function PatientHistory({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const h = useAsync(() => (params.patientId ? api(`/visits/patient/${params.patientId}`) : Promise.resolve(null)), [params.patientId]);

  if (!params.patientId) {
    return (<><PageHeader title={t('menu.patientHistory')} subtitle={t('history.subtitle')} /><PatientSearch /></>);
  }
  if (h.loading && !h.data) return <Loading />;
  if (h.error) return <ErrorBox error={h.error} />;
  const { patient, visits } = h.data;

  return (
    <>
      <PageHeader
        title={patient.name}
        subtitle={`${patient.patient_code} · ${genderLabel(patient.gender, t)} / ${ageLabel(patient)} · ${patient.mobile}`}
        actions={<Button variant="ghost" onClick={() => navigate('/doctor/history')}>{t('history.another')}</Button>}
      />
      {patient.past_history?.length > 0 && (
        <Card><p className="past-history-line"><b>{t('examine.pastHistory')}:</b> {pastHistoryLine(patient.past_history)}</p></Card>
      )}
      {!visits.length && <Card><Empty>{t('history.noVisits')}</Empty></Card>}
      <ol className="timeline">
        {visits.map((v) => (
          <li key={v.id}>
            <Card>
              <div className="tl-head">
                <div>
                  <b>{fmtDate(v.visit_date, true)}</b>
                  <span className="muted"> · {v.doctor_name || '—'}{v.token_no ? ` · #${v.token_no}` : ''}</span>
                </div>
                <div className="row-actions">
                  {auth.user.role === 'super_admin' && (   /* editing a past visit: Super Admin only */
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/doctor/examine/${v.id}?from=history&patient=${patient.id}`)}>
                      <Icon name="edit" size={14} /> {t('common.edit')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/doctor/prescription/${v.id}`)}>
                    <Icon name="print" size={14} /> {t('rxPrint.print')}
                  </Button>
                  <StatusBadge status={v.status} />
                  <span className="muted small">{money(v.consultation_fee)}</span>
                </div>
              </div>
              <Vitals v={v.vitals} visit={v} />
              <dl className="details compact">
                {v.complaints && <div><dt>{t('examine.complaints')}</dt><dd>{v.complaints}</dd></div>}
                {v.examination_notes && <div><dt>{t('examine.examination')}</dt><dd>{v.examination_notes}</dd></div>}
                {v.diagnosis && <div><dt>{t('examine.diagnosis')}</dt><dd>{v.diagnosis}</dd></div>}
                {v.advice && <div><dt>{t('examine.advice')}</dt><dd>{v.advice}</dd></div>}
                {v.dos_donts?.length > 0 && <DosDontSummary marks={v.dos_donts} />}
                {v.follow_up_date && <div><dt>{t('examine.followUp')}</dt><dd>{fmtDate(v.follow_up_date)}</dd></div>}
              </dl>
              {v.prescriptions?.length > 0 && (
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr><th>{t('examine.medicine')}</th><th>{t('examine.potency')}</th><th>{t('examine.dosage')}</th><th>{t('examine.repetition')}</th><th>{t('examine.duration')}</th></tr>
                    </thead>
                    <tbody>
                      {v.prescriptions.map((r) => (
                        <tr key={r.id}>
                          <td data-label={t('examine.medicine')}>{r.medicine_name}{r.instructions ? <small className="muted"> – {r.instructions}</small> : null}</td>
                          <td data-label={t('examine.potency')}>{r.potency || '—'}</td>
                          <td data-label={t('examine.dosage')}>{r.dosage || '—'}</td>
                          <td data-label={t('examine.repetition')}>{r.frequency || '—'}</td>
                          <td data-label={t('examine.duration')}>{r.duration || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
