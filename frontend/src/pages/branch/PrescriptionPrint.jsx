// Printable prescription (Doctor → Examine → Print, or Patient History → Print).
// "Print / PDF" uses the browser print dialog (choose "Save as PDF"); same A5 layout as the bill.
import { useT } from '../../lib/i18n.jsx';
import { api } from '../../lib/api.js';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, ErrorBox, Loading, useAsync } from '../../components/ui.jsx';
import { vitalsSummary } from '../../components/VitalSigns.jsx';
import Icon from '../../components/Icon.jsx';

export default function PrescriptionPrint({ params }) {
  const { t } = useT();
  const { data: v, error, loading } = useAsync(() => api(`/visits/${params.visitId}`), [params.visitId]);

  if (loading && !v) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const rx = v.prescriptions || [];
  const vitals = v.vitals_id ? vitalsSummary(v, t) : '';

  return (
    <>
      <div className="no-print page-header">
        <Button variant="ghost" onClick={() => window.history.back()}>‹ {t('dispense.back')}</Button>
        <div className="page-actions">
          <Button onClick={() => window.print()}><Icon name="print" size={16} /> {t('billing.print')}</Button>
        </div>
      </div>

      <article className="invoice prescription">
        <header className="inv-head">
          <div>
            <h1>{v.clinic_name}</h1>
            <p>{[v.clinic_address, v.clinic_city].filter(Boolean).join(', ')}</p>
            {v.clinic_phone && <p>{t('field.phone')}: {v.clinic_phone}</p>}
          </div>
          <div className="inv-brand">Ayush Pro</div>
        </header>

        <div className="inv-meta">
          <div>
            <span className="muted">{t('rxPrint.patient')}</span>
            <strong>{v.patient_name}</strong>
            <span>{v.patient_code} · {genderLabel(v.gender, t)} / {ageLabel(v)}</span>
            {v.mobile && <span>{v.mobile}</span>}
          </div>
          <div className="right">
            <span className="muted">{t('rxPrint.date')}</span>
            <strong>{fmtDate(v.visit_date)}</strong>
            {v.token_no && <span>{t('queue.token')} #{v.token_no}</span>}
            {v.doctor_name && <span>{t('menu.doctor')}: {v.doctor_name}</span>}
          </div>
        </div>

        {(vitals || v.vitals_comments) && (
          <p className="rx-print-line"><b>{t('vitals.title')}:</b> {[vitals, v.vitals_comments].filter(Boolean).join(' · ')}</p>
        )}
        {v.complaints && <p className="rx-print-line"><b>{t('examine.complaints')}:</b> {v.complaints}</p>}
        {v.diagnosis && <p className="rx-print-line"><b>{t('examine.diagnosis')}:</b> {v.diagnosis}</p>}

        <h2 className="rx-symbol">℞</h2>
        {rx.length ? (
          <table className="inv-table">
            <thead>
              <tr>
                <th>#</th><th>{t('examine.medicine')}</th><th>{t('examine.potency')}</th><th>{t('examine.dosage')}</th>
                <th>{t('examine.repetition')}</th><th>{t('examine.duration')}</th><th>{t('examine.instructions')}</th>
              </tr>
            </thead>
            <tbody>
              {rx.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><b>{r.medicine_name}</b>{r.generic_name && <small className="rx-generic">{r.generic_name}</small>}</td>
                  <td>{r.potency || '—'}</td>
                  <td>{r.dosage || '—'}</td>
                  <td>{r.frequency || '—'}</td>
                  <td>{r.duration || '—'}</td>
                  <td>{r.instructions || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">{t('rxPrint.noMedicines')}</p>}

        {v.advice && <p className="rx-print-line"><b>{t('examine.advice')}:</b> {v.advice}</p>}
        {v.follow_up_date && <p className="rx-print-line"><b>{t('examine.followUp')}:</b> {fmtDate(v.follow_up_date)}</p>}

        <footer className="rx-sign">
          <div>
            <span className="rx-sign-line" />
            <strong>{v.doctor_name || t('menu.doctor')}</strong>
            {(v.doctor_qualification || v.doctor_designation) && <span className="muted">{[v.doctor_qualification, v.doctor_designation].filter(Boolean).join(', ')}</span>}
          </div>
        </footer>
      </article>
    </>
  );
}
