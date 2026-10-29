// Printable Day Book chart (Doctor → Examine → Prescription → Day Book → Print chart).
// "Print / PDF" uses the browser print dialog; printed on A4 landscape so the routine columns fit.
// ?days=N sets how many days the chart covers (default: the Frequency's number of days, else up to the
// follow-up date, else 7).
import { useT } from '../../lib/i18n.jsx';
import { api } from '../../lib/api.js';
import { useLocation } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, ErrorBox, Loading, useAsync } from '../../components/ui.jsx';
import DayBookChart from '../../components/DayBookChart.jsx';
import Icon from '../../components/Icon.jsx';
import { cleanChartDays, defaultChartDays } from '../../../../shared/daybook.js';

export default function DayBookPrint({ params }) {
  const { t } = useT();
  const { query } = useLocation();
  const { data: v, error, loading } = useAsync(() => api(`/visits/${params.visitId}`), [params.visitId]);

  if (loading && !v) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const start = v.daybook_date || String(v.visit_date).slice(0, 10);
  const days = cleanChartDays(query.days, defaultChartDays(start, v.follow_up_date, v.daybook_frequency));

  return (
    <>
      <div className="no-print page-header">
        <Button variant="ghost" onClick={() => window.history.back()}>‹ {t('dispense.back')}</Button>
        <div className="page-actions">
          <Button onClick={() => window.print()}><Icon name="print" size={16} /> {t('billing.print')}</Button>
        </div>
      </div>

      <article className="invoice daybook-print">
        <header className="inv-head">
          <div>
            <h1>{v.clinic_name}</h1>
            <p>{[v.clinic_address, v.clinic_city].filter(Boolean).join(', ')}</p>
            {v.clinic_phone && <p>{t('field.phone')}: {v.clinic_phone}</p>}
          </div>
          <div className="inv-brand">{t('daybook.chartTitle')}</div>
        </header>

        <div className="inv-meta">
          <div>
            <span className="muted">{t('rxPrint.patient')}</span>
            <strong>{v.patient_name}</strong>
            <span>{v.patient_code} · {genderLabel(v.gender, t)} / {ageLabel(v)}</span>
            {v.mobile && <span>{v.mobile}</span>}
          </div>
          <div className="right">
            <span className="muted">{t('daybook.from')}</span>
            <strong>{fmtDate(start)}</strong>
            <span>{t('daybook.daysCount', { n: days })}</span>
            {v.doctor_name && <span>{t('menu.doctor')}: {v.doctor_name}</span>}
          </div>
        </div>

        <p className="rx-print-line">
          <b>{t('examine.dbroutine')}:</b> {v.daybook_routine.join(', ') || '—'}
          {v.daybook_duration && <> · <b>{t('examine.dbduration')}:</b> {v.daybook_duration}</>}
          {v.daybook_frequency && <> · <b>{t('examine.dbfrequency')}:</b> {v.daybook_frequency}</>}
        </p>

        <DayBookChart date={start} routines={v.daybook_routine} frequency={`${v.daybook_duration || ''} ${v.daybook_frequency || ''}`} days={days}
          values={v.daybook_chart} />
        <p className="muted small daybook-note">{t('daybook.chartNote')}</p>
      </article>
    </>
  );
}
