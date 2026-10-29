// Doctor → Examine: open a patient from the queue, enter complaints, diagnosis, prescription
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate, useLocation } from '../../lib/router.jsx';
import { ageLabel, fmtDate, fmtTime12, genderLabel, queueStatus, todayLocal } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Input, Loading, PageHeader, StatusBadge, TextArea, useAsync, useToast } from '../../components/ui.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import { RX_LIST_DEFAULTS } from '../../../../shared/dosage.js';
import DosDontList, { DosDontSummary } from '../../components/DosDontList.jsx';
import PastHistoryList, { PastHistorySummary } from '../../components/PastHistoryList.jsx';
import RxListPicker from '../../components/RxListPicker.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsForm, VitalsHistory, vitalsSummary } from '../../components/VitalSigns.jsx';
import Attachments from '../../components/Attachments.jsx';
import ComparativeStudy from '../../components/ComparativeStudy.jsx';
import DayBookChart from '../../components/DayBookChart.jsx';
import { cleanChartDays, defaultChartDays, MAX_CHART_DAYS } from '../../../../shared/daybook.js';

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), medicine_name: '', item_id: null, potency: '', dosage: '', frequency: '', duration: '', quantity: 1, instructions: '' });

/** A clinic's Potency / Dosage / Repetition / Do's and Don'ts list (by Order), replaced locally after an add / edit / delete. */
function useRxList(kind) {
  const loaded = useAsync(() => api(`/visits/${kind}-options`), [kind]);
  const [changed, setChanged] = useState(null);
  return [changed || loaded.data || { rows: RX_LIST_DEFAULTS[kind], added: [] }, setChanged];
}

// Page 1 – Doctor → Examine: today's patients still to be seen (Pre-Examine / With doctor)
function QueuePage() {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const queue = useAsync(() => api('/queue'), []);
  const rows = (queue.data?.rows || []).filter((r) => r.status === 'waiting' || r.status === 'with_doctor');

  async function open(r) {
    try {
      const v = r.visit_id ? { id: r.visit_id } : await api('/visits/start', { method: 'POST', body: { queue_id: r.id } });
      navigate(`/doctor/examine/${v.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title={t('examine.todayQueue')} subtitle={auth.activeClinic?.name}
        actions={<Button variant="ghost" onClick={queue.reload}>{t('common.refresh')}</Button>} />
      {queue.loading && !queue.data ? <Loading /> : <ErrorBox error={queue.error} onRetry={queue.reload} />}
      {queue.data && (
        <Card>
          <DataTable rows={rows} empty={t('examine.noneWaiting')} onRowClick={open} columns={[
            { key: 'token_no', label: t('queue.token'), render: (r) => <span className="token-chip">#{r.token_no}</span> },
            { key: 'patient_name', label: t('field.name'), render: (r) => <><b>{r.patient_name}</b><br /><span className="muted small">{r.patient_code}</span></> },
            { key: 'ga', label: t('field.genderAge'), render: (r) => `${genderLabel(r.gender, t)} / ${ageLabel(r)}` },
            { key: 'doctor_name', label: t('menu.doctor'), render: (r) => (r.doctor_name
              ? <>{r.doctor_name}{r.slot_time && <><br /><span className="muted small"><Icon name="clock" size={12} /> {fmtTime12(r.slot_time)}</span></>}</>
              : '—') },
            { key: 'vitals', label: t('vitals.title'), render: (r) => <span className="small">{r.vitals_id ? vitalsSummary(r, t) || t('vitals.commentsOnly') : <span className="muted">{t('examine.noVitals')}</span>}</span> },
            { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={queueStatus(r)} /> },
            { key: '_a', label: '', className: 'col-actions', render: (r) => (
              <Button size="sm" onClick={(e) => { e.stopPropagation(); open(r); }}>
                <Icon name="stethoscope" size={15} /> {r.visit_id ? t('examine.continue') : t('queue.examine')}
              </Button>
            ) },
          ]} />
        </Card>
      )}
    </>
  );
}

// The last 5 visits, each with what was filled in: Vital signs, Complaints & diagnosis, Prescription,
// Advice. Empty fields, sections and prescription columns are left out. Each visit can be folded.
const PAST_VISITS_SHOWN = 5;

const RX_COLUMNS = [
  ['medicine_name', 'examine.medicine'], ['potency', 'examine.potency'], ['dosage', 'examine.dosage'],
  ['frequency', 'examine.repetition'], ['duration', 'examine.duration'], ['instructions', 'examine.instructions'],
];
const filled = (v) => v != null && String(v).trim() !== '';

/** label → value rows, only the filled ones; null when none are filled */
function Fields({ rows }) {
  const shown = rows.filter(([, value]) => filled(value));
  if (!shown.length) return null;
  return (
    <dl className="pv-fields">
      {shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function PastVisitDetails({ v }) {
  const { t } = useT();
  // vitals taken at reception, or the older free-text vitals saved on the visit
  const vitals = v.vitals_id
    ? vitalsSummary(v, t)
    : [v.vitals?.bp && `${t('examine.bp')} ${v.vitals.bp}`, v.vitals?.pulse && `${t('examine.pulse')} ${v.vitals.pulse}`,
      v.vitals?.temp && `${t('examine.temp')} ${v.vitals.temp}`, v.vitals?.weight && `${t('examine.weight')} ${v.vitals.weight}`]
      .filter(Boolean).join(' · ');
  const rx = (v.prescriptions || []).filter((l) => filled(l.medicine_name));
  const rxCols = RX_COLUMNS.filter(([k]) => rx.some((l) => filled(l[k])));
  const dosDonts = v.dos_donts || [];

  const sections = [
    (filled(vitals) || filled(v.vitals_comments)) && (
      <section key="vitals" className="pv-sec">
        <h4>{t('vitals.title')}</h4>
        {filled(vitals) && <p className="pv-line">{vitals}</p>}
        <Fields rows={[[t('vitals.comments'), v.vitals_comments]]} />
      </section>
    ),
    v.queue_id && (
      <section key="attach" className="pv-sec wide">
        <h4>{t('attach.title')}</h4>
        <Attachments entry={{ id: v.queue_id }} canEdit={false} showHead={false} />
      </section>
    ),
    [v.complaints, v.examination_notes, v.diagnosis].some(filled) && (
      <section key="clinical" className="pv-sec">
        <h4>{t('examine.clinical')}</h4>
        <Fields rows={[[t('examine.complaints'), v.complaints], [t('examine.examination'), v.examination_notes], [t('examine.diagnosis'), v.diagnosis]]} />
      </section>
    ),
    v.medical_history?.length > 0 && (
      <section key="med" className="pv-sec">
        <h4>{t('examine.medicalHistory')}</h4>
        <PastHistorySummary value={v.medical_history} />
      </section>
    ),
    v.past_history?.length > 0 && (
      <section key="past" className="pv-sec">
        <h4>{t('examine.pastHistory')}</h4>
        <PastHistorySummary value={v.past_history} />
      </section>
    ),
    (filled(v.advice) || v.advice_unwilling || filled(v.follow_up_date) || dosDonts.length > 0) && (
      <section key="advice" className="pv-sec">
        <h4>{t('examine.advice')}</h4>
        <dl className="pv-fields">
          {filled(v.advice) && <div><dt>{t('examine.advice')}</dt><dd>{v.advice}</dd></div>}
          {v.advice_unwilling && <div><dt>{t('examine.unwilling')}</dt><dd>✓</dd></div>}
          {filled(v.follow_up_date) && <div><dt>{t('examine.followUp')}</dt><dd>{fmtDate(v.follow_up_date)}</dd></div>}
          {dosDonts.length > 0 && <DosDontSummary marks={dosDonts} />}
        </dl>
      </section>
    ),
    (rx.length > 0 || v.rx_unwilling) && (
      <section key="rx" className="pv-sec wide">
        <h4>{t('examine.prescription')}</h4>
        <div className="table-wrap">
          <table className="table table-compact pv-rx">
            <thead><tr>{rxCols.map(([k, label]) => <th key={k}>{t(label)}</th>)}</tr></thead>
            <tbody>
              {rx.map((l) => <tr key={l.id}>{rxCols.map(([k]) => <td key={k}>{l[k] || ''}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        {v.rx_unwilling && <p className="pv-line">{t('examine.unwilling')} ✓</p>}
      </section>
    ),
    (v.daybook_routine?.length > 0 || filled(v.daybook_duration) || filled(v.daybook_frequency)) && (
      <section key="daybook" className="pv-sec">
        <h4>{t('daybook.title')}</h4>
        <Fields rows={[[t('examine.dbdate'), v.daybook_date && fmtDate(v.daybook_date)], [t('examine.dbroutine'), (v.daybook_routine || []).join(', ')], [t('examine.dbduration'), v.daybook_duration], [t('examine.dbfrequency'), v.daybook_frequency]]} />
      </section>
    ),
  ].filter(Boolean);

  return sections.length ? <div className="pv-body">{sections}</div> : <p className="muted small pv-none">{t('examine.pvNothing')}</p>;
}

function PastVisits({ patientId, excludeId, footer }) {
  const { t } = useT();
  const h = useAsync(() => api(`/visits/patient/${patientId}`), [patientId]);
  const visits = (h.data?.visits || []).filter((v) => v.id !== excludeId).slice(0, PAST_VISITS_SHOWN);
  return (
    <Card title={t('examine.lastVisits', { n: PAST_VISITS_SHOWN })} actions={<a href={`#/doctor/history/${patientId}`}>{t('examine.fullHistory')}</a>}>
      {h.loading && !h.data && <Loading />}
      {h.data && !visits.length && <Empty>{t('examine.firstVisit')}</Empty>}
      {visits.map((v) => (
        <details key={v.id} className="pv-visit" open>
          <summary>
            <Icon name="chevronDown" size={14} />
            <b>{fmtDate(v.visit_date)}</b>
            <span className="muted">{[v.doctor_name, v.token_no && `#${v.token_no}`].filter(Boolean).join(' · ')}</span>
          </summary>
          <PastVisitDetails v={v} />
        </details>
      ))}
      {footer}
    </Card>
  );
}

// Vital signs recorded at reception (after Confirm); the doctor can correct them here.
// Lab Reports & Scans uploaded with the vitals are listed here too (files only – no upload here).
function QueueVitals({ queueId, patientName, readOnly, footer }) {
  const v = useAsync(() => api(`/queue/${queueId}/vitals`), [queueId]);
  return (
    <Card>
      {v.loading && !v.data ? <Loading /> : <ErrorBox error={v.error} onRetry={v.reload} />}
      {v.data && (
        <VitalsForm queueId={queueId} initial={v.data.vitals} onSaved={v.reload} readOnly={readOnly}
          beforeActions={<Attachments entry={{ id: queueId, patient_name: patientName }} canEdit={false} showHead={false} />} />
      )}
      {footer}
    </Card>
  );
}

// Complaints & diagnosis: its sections as tabs down the left side, in this order: [key, label]
const CLINICAL_TABS = [
  ['complaints', 'examine.complaints'],
  ['vitalsHistory', 'vitals.history'],
  ['medical', 'examine.medicalHistory'],
  ['exam', 'examine.pastHistory'],
  ['diagnosis', 'examine.diagnosis'],
  ['compare', 'cs.title'],
];

// Prescription: its sections as tabs down the left side: [key, label]
const RX_TABS = [
  ['medicines', 'examine.prescription'],
  ['daybook', 'daybook.title'],
];

// Patient details tabs, in this order: [key, label]
const EXAMINE_TABS = [
  ['history', 'examine.previousVisits'],
  ['vitals', 'vitals.title'],
  ['clinical', 'examine.clinical'],
  ['rx', 'examine.prescription'],
  ['advice', 'examine.advice'],
];

function VisitForm({ visitId, backPath }) {
  const { t } = useT();
  const toast = useToast();
  const { data: visit, error, loading, reload } = useAsync(() => api(`/visits/${visitId}`), [visitId]);
  const [potencyList, setPotencyList] = useRxList('potency');
  const [dosageList, setDosageList] = useRxList('dosage');
  const [repetitionList, setRepetitionList] = useRxList('repetition');
  const [dosDontList, setDosDontList] = useRxList('dosdont');
  const [pastList, setPastList] = useRxList('pasthistory');
  const [medList, setMedList] = useRxList('medhistory');
  const [routineList, setRoutineList] = useRxList('dbroutine');
  const [dbDurationList, setDbDurationList] = useRxList('dbduration');
  const [dbFrequencyList, setDbFrequencyList] = useRxList('dbfrequency');
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [focusLine, setFocusLine] = useState(null);   // line whose Medicine box gets the cursor after render
  const [saving, setSaving] = useState(null);
  const [tab, setTab] = useState('history');
  const [subTab, setSubTab] = useState('complaints');   // Complaints & diagnosis section
  const [csCount, setCsCount] = useState(0);             // Comparative Study rows (for the tab mark)
  const [rxTab, setRxTab] = useState('medicines');       // Prescription section
  const [chartDaysText, setChartDaysText] = useState('');  // Day Book chart: days typed ('' = default)
  const tabIndex = EXAMINE_TABS.findIndex(([key]) => key === tab);
  const prevTab = EXAMINE_TABS[tabIndex - 1];
  const nextTab = EXAMINE_TABS[tabIndex + 1];
  // Previous / Next: switch tab and bring the tab bar back into view
  const goTab = (key) => {
    setTab(key);
    document.getElementById(`tab-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const tabNav = (
    <div className="tab-nav">
      {prevTab ? (
        <button type="button" className="tab-nav-btn prev" onClick={() => goTab(prevTab[0])}>
          <Icon name="chevronLeft" size={18} />
          <span><small>{t('common.previous')}</small>{t(prevTab[1])}</span>
        </button>
      ) : <span />}
      <span className="tab-nav-step">{t('examine.step', { n: tabIndex + 1, total: EXAMINE_TABS.length })}</span>
      {nextTab ? (
        <button type="button" className="tab-nav-btn next" onClick={() => goTab(nextTab[0])}>
          <span><small>{t('common.next')}</small>{t(nextTab[1])}</span>
          <Icon name="chevronRight" size={18} />
        </button>
      ) : <span />}
    </div>
  );

  useEffect(() => {
    if (!visit) return;
    setF({
      complaints: visit.complaints || '', examination_notes: visit.examination_notes || '', diagnosis: visit.diagnosis || '',
      advice: visit.advice || '', advice_unwilling: !!visit.advice_unwilling, rx_unwilling: !!visit.rx_unwilling,
      daybook_date: visit.daybook_date || todayLocal(), daybook_routine: visit.daybook_routine || [], daybook_chart: visit.daybook_chart || {}, daybook_duration: visit.daybook_duration || '', daybook_frequency: visit.daybook_frequency || '', follow_up_date: visit.follow_up_date || '', consultation_fee: visit.consultation_fee ?? 0,
      dos_donts: visit.dos_donts || [], past_history: visit.past_history || [], medical_history: visit.medical_history || [],
    });
    setLines(visit.prescriptions.length ? visit.prescriptions.map((p) => ({ ...p, key: String(p.id) })) : [emptyLine()]);
  }, [visit]);

  // "+ Add medicine": put the cursor in the new line's Medicine box
  useEffect(() => {
    if (!focusLine) return;
    document.querySelector(`[data-line="${focusLine}"] .picker input`)?.focus();
    setFocusLine(null);
  }, [focusLine, lines]);

  if (loading && !visit) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!f) return null;

  const locked = visit.issue_count > 0;
  // Day Book chart: the Frequency's number of days, else up to the follow-up date, else 7 – unless Days is typed
  const chartDayCount = cleanChartDays(chartDaysText, defaultChartDays(f.daybook_date, f.follow_up_date, f.daybook_frequency));
  const rxCount = lines.filter((l) => l.medicine_name.trim()).length;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(complete, { print = false, busy } = {}) {
    setSaving(busy || (print ? 'print' : complete ? 'complete' : 'draft'));
    try {
      const body = {
        complaints: f.complaints, examination_notes: f.examination_notes, diagnosis: f.diagnosis, advice: f.advice, advice_unwilling: f.advice_unwilling, rx_unwilling: f.rx_unwilling,
        daybook_routine: f.daybook_routine, daybook_duration: f.daybook_duration, daybook_frequency: f.daybook_frequency,
        daybook_chart: f.daybook_chart,
        // the date is kept only with a Day Book entry (it is filled in by default)
        daybook_date: (f.daybook_routine.length || f.daybook_duration || f.daybook_frequency) ? f.daybook_date || todayLocal() : null,
        follow_up_date: f.follow_up_date || null, consultation_fee: f.consultation_fee, dos_donts: f.dos_donts,
        past_history: f.past_history, medical_history: f.medical_history,
        complete,
      };
      if (!locked) body.prescriptions = lines.filter((l) => l.medicine_name.trim()).map(({ key, ...l }) => l);
      await api(`/visits/${visitId}`, { method: 'PUT', body });
      // printout shows what was just saved; print = true (prescription) or the page to open (Day Book chart)
      if (print) { navigate(print === true ? `/doctor/prescription/${visitId}` : print); return; }
      toast(complete ? t('examine.completed') : t('common.saved'));
      if (complete) navigate(backPath);
      else reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="patient-strip">
        <span className="token-chip big">#{visit.token_no ?? '—'}</span>
        <div>
          <h2>{visit.patient_name}</h2>
          <span className="muted">{visit.patient_code} · {genderLabel(visit.gender, t)} / {ageLabel(visit)} · {visit.mobile}{visit.blood_group ? ` · ${visit.blood_group}` : ''}</span>
        </div>
        <StatusBadge status={visit.status} />
        {visit.bill_id && <Badge tone="success">{t('status.billed')}</Badge>}
      </div>

      {/* Tabs: every panel stays mounted (only hidden), so nothing typed is lost when switching */}
      <div className="tabs examine-tabs" role="tablist">
        {EXAMINE_TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`}
            className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {t(label)}
            {key === 'rx' && rxCount > 0 && <span className="tab-count">{rxCount}</span>}
          </button>
        ))}
      </div>

      <section role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden={tab !== 'history'}>
        <PastVisits patientId={visit.patient_id} excludeId={visit.id} footer={tabNav} />
      </section>

      <section role="tabpanel" id="panel-vitals" aria-labelledby="tab-vitals" hidden={tab !== 'vitals'}>
      {visit.queue_id ? <QueueVitals queueId={visit.queue_id} patientName={visit.patient_name} readOnly={visit.queue_status === 'cancelled'} footer={tabNav} /> : <Card><Empty>{t('examine.noVitals')}</Empty>{tabNav}</Card>}
      {visit.vitals && Object.values(visit.vitals).some(Boolean) && (
        <p className="muted small">{t('vitals.olderNote')}: {[
          visit.vitals.bp && `${t('examine.bp')} ${visit.vitals.bp}`, visit.vitals.pulse && `${t('examine.pulse')} ${visit.vitals.pulse}`,
          visit.vitals.temp && `${t('examine.temp')} ${visit.vitals.temp}`, visit.vitals.weight && `${t('examine.weight')} ${visit.vitals.weight}`,
        ].filter(Boolean).join(' · ')}</p>
      )}
      </section>

      <section role="tabpanel" id="panel-clinical" aria-labelledby="tab-clinical" hidden={tab !== 'clinical'}>
      <Card>
        {/* sections as tabs on the left; every section stays mounted (only hidden), so nothing typed is lost */}
        <div className="subtabs">
          <div className="subtab-list" role="tablist" aria-orientation="vertical">
            {CLINICAL_TABS.map(([key, label], i) => {
              const filled = {
                complaints: f.complaints.trim() ? '✓' : null,
                medical: f.medical_history.length || (f.examination_notes.trim() ? '✓' : null),
                exam: f.past_history.length || null,
                diagnosis: f.diagnosis.trim() ? '✓' : null,
                compare: csCount || null,
              }[key];
              return (
                <button key={key} type="button" role="tab" id={`sub-${key}`} aria-selected={subTab === key} aria-controls={`subpanel-${key}`}
                  className={subTab === key ? 'on' : ''} onClick={() => setSubTab(key)}>
                  <span className="subtab-no">{i + 1}</span>
                  <span className="subtab-label">{t(label)}</span>
                  {filled && <span className="subtab-mark">{filled}</span>}
                </button>
              );
            })}
          </div>
          <div className="subtab-panels">
            <section role="tabpanel" id="subpanel-complaints" aria-labelledby="sub-complaints" hidden={subTab !== 'complaints'}>
              <TextArea label={t('examine.complaints')} rows={8} value={f.complaints} onChange={set('complaints')} />
            </section>
            {/* Medical History: the list on the left, the notes on the right */}
            <section role="tabpanel" id="subpanel-medical" aria-labelledby="sub-medical" hidden={subTab !== 'medical'} className="tab-split">
              <PastHistoryList kind="medhistory" list={medList} onListChange={setMedList} copiedFrom={visit.medical_history_from}
                value={f.medical_history} onChange={(medical_history) => setF((cur) => ({ ...cur, medical_history }))} />
              <TextArea label={t('examine.examination')} rows={10} value={f.examination_notes} onChange={set('examination_notes')} />
            </section>
            <section role="tabpanel" id="subpanel-exam" aria-labelledby="sub-exam" hidden={subTab !== 'exam'}>
              <PastHistoryList list={pastList} onListChange={setPastList} copiedFrom={visit.past_history_from}
                value={f.past_history} onChange={(past_history) => setF((cur) => ({ ...cur, past_history }))} />
            </section>
            <section role="tabpanel" id="subpanel-diagnosis" aria-labelledby="sub-diagnosis" hidden={subTab !== 'diagnosis'}>
              <TextArea label={t('examine.diagnosis')} rows={8} value={f.diagnosis} onChange={set('diagnosis')} />
            </section>
            <section role="tabpanel" id="subpanel-compare" aria-labelledby="sub-compare" hidden={subTab !== 'compare'}>
              <ComparativeStudy patientId={visit.patient_id} visitId={visit.id} onCount={setCsCount} />
            </section>
            {/* last 10 visits' vital signs */}
            <section role="tabpanel" id="subpanel-vitalsHistory" aria-labelledby="sub-vitalsHistory" hidden={subTab !== 'vitalsHistory'}>
              <VitalsHistory patientId={visit.patient_id} excludeVisitId={visit.id} />
            </section>
          </div>
        </div>
        {tabNav}
      </Card>
      </section>

      <section role="tabpanel" id="panel-rx" aria-labelledby="tab-rx" hidden={tab !== 'rx'}>
      <Card actions={(
        <span className="row-actions">
          {locked && <Badge tone="info">{t('examine.rxLocked')}</Badge>}
          <Button variant="ghost" size="sm" onClick={() => save(false, { print: true })} loading={saving === 'print'}>
            <Icon name="print" size={15} /> {t('rxPrint.print')}
          </Button>
        </span>
      )}>
        {/* sections as tabs on the left: the medicines, then the Day Book */}
        <div className="subtabs subtabs-narrow">
          <div className="subtab-list" role="tablist" aria-orientation="vertical">
            {RX_TABS.map(([key, label], i) => {
              const mark = { medicines: rxCount || null, daybook: (f.daybook_routine.length || f.daybook_duration || f.daybook_frequency) ? '✓' : null }[key];
              return (
                <button key={key} type="button" role="tab" id={`rxsub-${key}`} aria-selected={rxTab === key} aria-controls={`rxpanel-${key}`}
                  className={rxTab === key ? 'on' : ''} onClick={() => setRxTab(key)}>
                  <span className="subtab-no">{i + 1}</span>
                  <span className="subtab-label">{t(label)}</span>
                  {mark && <span className="subtab-mark">{mark}</span>}
                </button>
              );
            })}
          </div>
          <div className="subtab-panels">
            <section role="tabpanel" id="rxpanel-medicines" aria-labelledby="rxsub-medicines" hidden={rxTab !== 'medicines'}>
              <div className="rx-table">
                <div className="rx-row rx-head">
                  <span>{t('examine.medicine')}</span><span>{t('examine.potency')}</span><span>{t('examine.dosage')}</span><span>{t('examine.repetition')}</span>
                  <span>{t('examine.duration')}</span><span>{t('examine.instructions')}</span><span /><span />
                </div>
                {lines.map((l) => (
                  <div key={l.key} className="rx-row" data-line={l.key}>
                    {locked ? <span className="rx-locked">{l.medicine_name}</span> : (
                      <ItemPicker value={l.medicine_name} ariaLabel={t('examine.medicine')} placeholder={t('examine.medicineHint')}
                        onPick={(p) => setLine(l.key, { medicine_name: p.medicine_name, item_id: p.item_id })} />
                    )}
                    <RxListPicker kind="potency" value={l.potency || ''} disabled={locked} list={potencyList}
                      onChange={(v) => setLine(l.key, { potency: v })} onListChange={setPotencyList} />
                    <RxListPicker kind="dosage" value={l.dosage || ''} disabled={locked} list={dosageList}
                      onChange={(v) => setLine(l.key, { dosage: v })} onListChange={setDosageList} />
                    <RxListPicker kind="repetition" value={l.frequency || ''} disabled={locked} list={repetitionList}
                      onChange={(v) => setLine(l.key, { frequency: v })} onListChange={setRepetitionList} />
                    <input aria-label={t('examine.duration')} placeholder="7 days" value={l.duration || ''} disabled={locked} onChange={(e) => setLine(l.key, { duration: e.target.value })} />
                    <input aria-label={t('examine.instructions')} placeholder={t('examine.instructionsHint')} value={l.instructions || ''} disabled={locked} onChange={(e) => setLine(l.key, { instructions: e.target.value })} />
                    {!locked && (
                      <>
                        {/* + adds a new medicine line just below this one */}
                        <button type="button" className="icon-btn rx-add" aria-label={t('examine.addMedicine')} title={t('examine.addMedicine')}
                          onClick={() => { const line = emptyLine(); setLines((ls) => ls.flatMap((x) => (x.key === l.key ? [x, line] : [x]))); setFocusLine(line.key); }}>
                          <Icon name="plus" size={16} />
                        </button>
                        <button type="button" className="icon-btn" aria-label={t('common.remove')} title={t('common.remove')}
                          onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))}>
                          <Icon name="trash" size={16} />
                        </button>
                      </>
                    )}
                    {l.item_id ? <small className="rx-stock muted">{t('examine.inStock')}</small> : l.medicine_name ? <small className="rx-stock warn">{t('examine.notInStock')}</small> : null}
                  </div>
                ))}
              </div>
              <div className="rx-foot">
                <label className="check-line rx-unwilling">
                  <input type="checkbox" checked={f.rx_unwilling} onChange={(e) => setF({ ...f, rx_unwilling: e.target.checked })} />
                  {t('examine.unwilling')}
                </label>
              </div>
            </section>
            <section role="tabpanel" id="rxpanel-daybook" aria-labelledby="rxsub-daybook" hidden={rxTab !== 'daybook'}>
              {/* one row: Routine, Duration, Frequency – each from its own list (+ New / Edit / Delete); saved with the visit */}
              <div className="rx-table">
                <div className="db-row rx-head">
                  <span>{t('examine.dbdate')}</span><span>{t('examine.dbroutine')}</span><span>{t('examine.dbduration')}</span><span>{t('examine.dbfrequency')}</span>
                </div>
                <div className="db-row">
                  <input type="date" aria-label={t('examine.dbdate')} value={f.daybook_date}
                    onChange={(e) => setF((cur) => ({ ...cur, daybook_date: e.target.value }))} />
                  <RxListPicker kind="dbroutine" multiple value={f.daybook_routine} list={routineList}
                    onChange={(v) => setF((cur) => ({ ...cur, daybook_routine: v }))} onListChange={setRoutineList} />
                  <RxListPicker kind="dbduration" value={f.daybook_duration} list={dbDurationList}
                    onChange={(v) => setF((cur) => ({ ...cur, daybook_duration: v }))} onListChange={setDbDurationList} />
                  <RxListPicker kind="dbfrequency" value={f.daybook_frequency} list={dbFrequencyList}
                    onChange={(v) => setF((cur) => ({ ...cur, daybook_frequency: v }))} onListChange={setDbFrequencyList} />
                </div>
              </div>
              {/* day-wise chart for the patient: from the Date, by Frequency, one column per Routine */}
              <div className="dosdont-head daybook-chart-head">
                <h3>{t('daybook.chartTitle')}</h3>
                <span className="row-actions">
                  <label className="daybook-days">
                    {t('daybook.days')}
                    <input type="number" min="1" max={MAX_CHART_DAYS} step="1" inputMode="numeric" value={chartDaysText || chartDayCount}
                      onChange={(e) => setChartDaysText(e.target.value)} />
                  </label>
                  <Button variant="ghost" size="sm" disabled={!f.daybook_routine.length} loading={saving === 'chart'}
                    onClick={() => save(false, { print: `/doctor/daybook/${visitId}?days=${chartDayCount}`, busy: 'chart' })}>
                    <Icon name="print" size={15} /> {t('daybook.printChart')}
                  </Button>
                </span>
              </div>
              <div className="table-wrap">
                <DayBookChart date={f.daybook_date} routines={f.daybook_routine} frequency={`${f.daybook_duration} ${f.daybook_frequency}`} days={chartDayCount}
                  values={f.daybook_chart} onChange={(key, text) => setF((cur) => ({ ...cur, daybook_chart: { ...cur.daybook_chart, [key]: text } }))} />
              </div>
            </section>
          </div>
        </div>
        {tabNav}
      </Card>
      </section>

      <section role="tabpanel" id="panel-advice" aria-labelledby="tab-advice" hidden={tab !== 'advice'}>
      <Card>
        {/* left: advice, follow-up, fee – right: Do's and Don'ts */}
        <div className="tab-split">
          <div className="tab-split-left">
            <TextArea label={t('examine.advice')} rows={4} value={f.advice} onChange={set('advice')} />
            <label className="check-line">
              <input type="checkbox" checked={f.advice_unwilling} onChange={(e) => setF({ ...f, advice_unwilling: e.target.checked })} />
              {t('examine.unwilling')}
            </label>
            <Input label={t('examine.followUp')} type="date" value={f.follow_up_date} onChange={set('follow_up_date')} />
            <Input label={t('field.consultationFee')} type="number" min="0" step="0.01" value={f.consultation_fee} onChange={set('consultation_fee')} disabled={!!visit.bill_id} />
          </div>
          <DosDontList list={dosDontList} onListChange={setDosDontList}
            marks={f.dos_donts} onChange={(dos_donts) => setF((cur) => ({ ...cur, dos_donts }))} />
        </div>
        {tabNav}
      </Card>
      </section>

      <div className="form-actions sticky-actions">
        <Button variant="ghost" onClick={() => save(false)} loading={saving === 'draft'}>{t('examine.saveDraft')}</Button>
        <Button onClick={() => save(true)} loading={saving === 'complete'}>{visit.status === 'completed' ? t('examine.saveCompleted') : t('examine.complete')}</Button>
      </div>
    </>
  );
}

export default function Examine({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const { query } = useLocation();
  const visitId = params.visitId;
  if (!visitId) return <QueuePage />;

  // Opened with Edit from Patient History (?from=history&patient=12): back / finish return there
  const patientId = Number(query.patient);
  const fromHistory = query.from === 'history' && Number.isInteger(patientId) && patientId > 0;
  const backPath = fromHistory ? `/doctor/history/${patientId}` : '/doctor/examine';

  // Page 2 – one patient's details (previous visits, vitals, examination)
  return (
    <>
      <PageHeader title={t('examine.patientDetails')} subtitle={auth.activeClinic?.name} compact
        actions={<Button variant="ghost" onClick={() => navigate(backPath)}>← {t(fromHistory ? 'examine.backToHistory' : 'examine.backToQueue')}</Button>} />
      <VisitForm visitId={visitId} backPath={backPath} />
    </>
  );
}
