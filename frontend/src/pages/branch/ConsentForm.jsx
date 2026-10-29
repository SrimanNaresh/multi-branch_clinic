// Patient & Queue → Patient Consent Form: find a patient, then print their consent form
// (Patient Name, Age / Date of Birth, Gender, Mobile Number, Address filled in) for signing.
// "Blank form" prints the same form with empty lines, for a patient not yet registered.
// "Print / PDF" uses the browser print dialog; the form prints on A4 portrait.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel, todayLocal } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

const CONSENT_POINTS = 5;   // consent.point.1 … consent.point.5

function PatientSearch() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = useAsync(() => (dq.trim() ? api('/patients', { query: { q: dq.trim(), limit: 20 } }) : Promise.resolve({ rows: [] })), [dq]);
  return (
    <Card actions={(
      <Button variant="ghost" size="sm" onClick={() => navigate('/queue/consent/blank')}>
        <Icon name="print" size={15} /> {t('consent.blank')}
      </Button>
    )}>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder={t('patients.searchHint')} autoFocus /></div>
      {!dq.trim() ? <Empty>{t('queue.typeToSearch')}</Empty> : r.loading && !r.data ? <Loading /> : (
        <ul className="result-list">
          {r.data?.rows.map((p) => (
            <li key={p.id}>
              <div className="result-main">
                <strong>{p.name}</strong>
                <span className="muted">{p.patient_code} · {p.mobile} · {genderLabel(p.gender, t)} / {ageLabel(p)}</span>
              </div>
              <Button variant="ghost" onClick={() => navigate(`/queue/consent/${p.id}`)}>{t('consent.open')}</Button>
            </li>
          ))}
          {r.data?.rows.length === 0 && <Empty>{t('queue.noMatch')}</Empty>}
        </ul>
      )}
    </Card>
  );
}

/** One "label: value" line of the form; an empty value prints as a line to write on. */
function FormLine({ label, value }) {
  return (
    <div className="consent-line">
      <span className="consent-label">{label}</span>
      <span className="consent-value">{value || ''}</span>
    </div>
  );
}

function ConsentSheet({ patient: p, clinic: c }) {
  const { t } = useT();
  const clinicName = c?.name || '';
  const age = p && (p.age_years != null || p.dob) ? ageLabel(p) : '';
  const ageDob = p ? [age && `${age} ${t('consent.years')}`, p.dob && fmtDate(p.dob)].filter(Boolean).join(' / ') : '';
  return (
    <article className="invoice consent-print">
      <header className="inv-head">
        <div>
          <h1>{clinicName}</h1>
          <p>{[c?.address, c?.city].filter(Boolean).join(', ')}</p>
          {c?.phone && <p>{t('field.phone')}: {c.phone}</p>}
        </div>
        <div className="inv-brand">Ayush Pro</div>
      </header>

      <h2 className="consent-title">{t('consent.title')}</h2>

      <section className="consent-details">
        <FormLine label={t('consent.patientName')} value={p?.name} />
        {p?.patient_code && <FormLine label={t('consent.patientId')} value={p.patient_code} />}
        <FormLine label={t('consent.ageDob')} value={ageDob} />
        <FormLine label={t('consent.gender')} value={p?.gender ? genderLabel(p.gender, t) : ''} />
        <FormLine label={t('consent.mobile')} value={p?.mobile} />
        <FormLine label={t('consent.address')} value={p?.address} />
      </section>

      <p className="consent-text">{t('consent.intro', { name: p?.name || '______________________', clinic: clinicName || '______________________' })}</p>
      <ol className="consent-points">
        {Array.from({ length: CONSENT_POINTS }, (_, i) => <li key={i}>{t(`consent.point.${i + 1}`)}</li>)}
      </ol>
      <p className="consent-text">{t('consent.closing')}</p>

      <div className="consent-signs">
        <div><span className="rx-sign-line" />{t('consent.signPatient')}</div>
        <div><span className="rx-sign-line" />{t('consent.signWitness')}</div>
        <div><span className="rx-sign-line" />{t('consent.signDoctor')}</div>
      </div>
      <div className="consent-details consent-foot">
        <FormLine label={t('consent.guardian')} value="" />
        <FormLine label={t('consent.date')} value={p ? fmtDate(todayLocal()) : ''} />
        <FormLine label={t('consent.place')} value={p ? c?.city : ''} />
      </div>
    </article>
  );
}

export default function ConsentForm({ params }) {
  const { t } = useT();
  const blank = params.patientId === 'blank';
  const id = params.patientId && !blank ? params.patientId : null;
  const pt = useAsync(() => (id ? api(`/patients/${id}`) : Promise.resolve(null)), [id]);
  const clinic = useAsync(() => (params.patientId ? api('/patients/clinic-info') : Promise.resolve(null)), [!!params.patientId]);

  if (!params.patientId) {
    return (<><PageHeader title={t('menu.consentForm')} subtitle={t('consent.subtitle')} /><PatientSearch /></>);
  }
  if ((pt.loading && !pt.data) || (clinic.loading && !clinic.data)) return <Loading />;
  if (pt.error || clinic.error) return <ErrorBox error={pt.error || clinic.error} />;
  return (
    <>
      <div className="no-print page-header">
        <Button variant="ghost" onClick={() => navigate('/queue/consent')}>‹ {t('dispense.back')}</Button>
        <div className="page-actions">
          <Button onClick={() => window.print()}><Icon name="print" size={16} /> {t('billing.print')}</Button>
        </div>
      </div>
      <ConsentSheet patient={blank ? null : pt.data} clinic={clinic.data} />
    </>
  );
}
