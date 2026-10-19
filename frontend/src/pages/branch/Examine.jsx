// Doctor → Examine: open a patient from the queue, enter complaints, diagnosis, prescription
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Input, Loading, PageHeader, StatusBadge, TextArea, useAsync, useToast } from '../../components/ui.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import { RX_LIST_DEFAULTS } from '../../../../shared/dosage.js';
import RxListPicker from '../../components/RxListPicker.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsForm, vitalsSummary } from '../../components/VitalSigns.jsx';

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), medicine_name: '', item_id: null, potency: '', dosage: '', frequency: '', duration: '', quantity: 1, instructions: '' });
const rxLine = (r) => [r.medicine_name, r.potency].filter(Boolean).join(' ');

/** A clinic's Potency / Dosage / Repetition list (by Order), replaced locally after an add / edit / delete. */
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
              ? <>{r.doctor_name}{r.slot_time && <><br /><span className="muted small"><Icon name="clock" size={12} /> {r.slot_time}</span></>}</>
              : '—') },
            { key: 'vitals', label: t('vitals.title'), render: (r) => <span className="small">{r.vitals_id ? vitalsSummary(r, t) || t('vitals.commentsOnly') : <span className="muted">{t('examine.noVitals')}</span>}</span> },
            { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
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

function PastVisits({ patientId, excludeId }) {
  const { t } = useT();
  const h = useAsync(() => api(`/visits/patient/${patientId}`), [patientId]);
  const visits = (h.data?.visits || []).filter((v) => v.id !== excludeId).slice(0, 3);
  return (
    <Card title={t('examine.previousVisits')} actions={<a href={`#/doctor/history/${patientId}`}>{t('examine.fullHistory')}</a>}>
      {h.loading && !h.data && <Loading />}
      {h.data && !visits.length && <Empty>{t('examine.firstVisit')}</Empty>}
      {visits.map((v) => (
        <div key={v.id} className="past-visit">
          <div className="pv-head"><b>{fmtDate(v.visit_date)}</b><span className="muted">{v.doctor_name}</span></div>
          {v.diagnosis && <p><span className="muted">{t('examine.diagnosis')}:</span> {v.diagnosis}</p>}
          {v.prescriptions?.length > 0 && <p className="muted small">{v.prescriptions.map(rxLine).join(', ')}</p>}
        </div>
      ))}
    </Card>
  );
}

// Vital signs recorded at reception (after Confirm); the doctor can correct them here.
function QueueVitals({ queueId, readOnly }) {
  const { t } = useT();
  const v = useAsync(() => api(`/queue/${queueId}/vitals`), [queueId]);
  return (
    <Card title={t('vitals.title')}>
      {v.loading && !v.data ? <Loading /> : <ErrorBox error={v.error} onRetry={v.reload} />}
      {v.data && <VitalsForm queueId={queueId} initial={v.data.vitals} onSaved={v.reload} readOnly={readOnly} />}
    </Card>
  );
}

function VisitForm({ visitId }) {
  const { t } = useT();
  const toast = useToast();
  const { data: visit, error, loading, reload } = useAsync(() => api(`/visits/${visitId}`), [visitId]);
  const [potencyList, setPotencyList] = useRxList('potency');
  const [dosageList, setDosageList] = useRxList('dosage');
  const [repetitionList, setRepetitionList] = useRxList('repetition');
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!visit) return;
    setF({
      complaints: visit.complaints || '', examination_notes: visit.examination_notes || '', diagnosis: visit.diagnosis || '',
      advice: visit.advice || '', follow_up_date: visit.follow_up_date || '', consultation_fee: visit.consultation_fee ?? 0,
    });
    setLines(visit.prescriptions.length ? visit.prescriptions.map((p) => ({ ...p, key: String(p.id) })) : [emptyLine()]);
  }, [visit]);

  if (loading && !visit) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!f) return null;

  const locked = visit.issue_count > 0;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(complete, { print = false } = {}) {
    setSaving(print ? 'print' : complete ? 'complete' : 'draft');
    try {
      const body = {
        complaints: f.complaints, examination_notes: f.examination_notes, diagnosis: f.diagnosis, advice: f.advice,
        follow_up_date: f.follow_up_date || null, consultation_fee: f.consultation_fee,
        complete,
      };
      if (!locked) body.prescriptions = lines.filter((l) => l.medicine_name.trim()).map(({ key, ...l }) => l);
      await api(`/visits/${visitId}`, { method: 'PUT', body });
      if (print) { navigate(`/doctor/prescription/${visitId}`); return; }   // printout shows what was just saved
      toast(complete ? t('examine.completed') : t('common.saved'));
      if (complete) navigate('/doctor/examine');
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

      <PastVisits patientId={visit.patient_id} excludeId={visit.id} />

      {visit.queue_id && <QueueVitals queueId={visit.queue_id} readOnly={visit.queue_status === 'cancelled'} />}
      {visit.vitals && Object.values(visit.vitals).some(Boolean) && (
        <p className="muted small">{t('vitals.olderNote')}: {[
          visit.vitals.bp && `${t('examine.bp')} ${visit.vitals.bp}`, visit.vitals.pulse && `${t('examine.pulse')} ${visit.vitals.pulse}`,
          visit.vitals.temp && `${t('examine.temp')} ${visit.vitals.temp}`, visit.vitals.weight && `${t('examine.weight')} ${visit.vitals.weight}`,
        ].filter(Boolean).join(' · ')}</p>
      )}

      <Card title={t('examine.clinical')}>
        <div className="form-grid">
          <TextArea label={t('examine.complaints')} value={f.complaints} onChange={set('complaints')} />
          <TextArea label={t('examine.examination')} value={f.examination_notes} onChange={set('examination_notes')} />
          <TextArea label={t('examine.diagnosis')} rows={2} value={f.diagnosis} onChange={set('diagnosis')} />
        </div>
      </Card>

      <Card title={t('examine.prescription')} actions={(
        <span className="row-actions">
          {locked && <Badge tone="info">{t('examine.rxLocked')}</Badge>}
          <Button variant="ghost" size="sm" onClick={() => save(false, { print: true })} loading={saving === 'print'}>
            <Icon name="print" size={15} /> {t('rxPrint.print')}
          </Button>
        </span>
      )}>
        <div className="rx-table">
          <div className="rx-row rx-head">
            <span>{t('examine.medicine')}</span><span>{t('examine.potency')}</span><span>{t('examine.dosage')}</span><span>{t('examine.repetition')}</span>
            <span>{t('examine.duration')}</span><span>{t('examine.instructions')}</span><span />
          </div>
          {lines.map((l) => (
            <div key={l.key} className="rx-row">
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
                <button type="button" className="icon-btn" aria-label={t('common.remove')}
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))}>
                  <Icon name="trash" size={16} />
                </button>
              )}
              {l.item_id ? <small className="rx-stock muted">{t('examine.inStock')}</small> : l.medicine_name ? <small className="rx-stock warn">{t('examine.notInStock')}</small> : null}
            </div>
          ))}
        </div>
        {!locked && <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Icon name="plus" size={15} /> {t('examine.addMedicine')}</Button>}
      </Card>

      <Card title={t('examine.advice')}>
        <div className="form-grid">
          <TextArea label={t('examine.advice')} rows={2} value={f.advice} onChange={set('advice')} />
          <Input label={t('examine.followUp')} type="date" value={f.follow_up_date} onChange={set('follow_up_date')} />
          <Input label={t('field.consultationFee')} type="number" min="0" step="0.01" value={f.consultation_fee} onChange={set('consultation_fee')} disabled={!!visit.bill_id} />
        </div>
      </Card>

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
  const visitId = params.visitId;
  if (!visitId) return <QueuePage />;

  // Page 2 – one patient's details (previous visits, vitals, examination)
  return (
    <>
      <PageHeader title={t('examine.patientDetails')} subtitle={auth.activeClinic?.name}
        actions={<Button variant="ghost" onClick={() => navigate('/doctor/examine')}>← {t('examine.backToQueue')}</Button>} />
      <VisitForm visitId={visitId} />
    </>
  );
}
