// Doctor → Examine: open a patient from the queue, enter complaints, diagnosis, prescription
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, StatusBadge, TextArea, useAsync, useToast } from '../../components/ui.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import Icon from '../../components/Icon.jsx';

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), medicine_name: '', item_id: null, dosage: '', frequency: '', duration: '', quantity: 1, instructions: '' });

function QueuePanel({ currentVisitId }) {
  const { t } = useT();
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
    <Card title={t('examine.todayQueue')} actions={<Button size="sm" variant="ghost" onClick={queue.reload}>{t('common.refresh')}</Button>} className="queue-panel">
      {queue.loading && !queue.data ? <Loading /> : <ErrorBox error={queue.error} />}
      {queue.data && !rows.length && <Empty>{t('examine.noneWaiting')}</Empty>}
      <ul className="queue-mini">
        {rows.map((r) => (
          <li key={r.id} className={String(r.visit_id) === String(currentVisitId) ? 'current' : ''}>
            <button onClick={() => open(r)}>
              <span className="token-chip">#{r.token_no}</span>
              <span className="qm-name">{r.patient_name}<small className="muted">{r.patient_code}</small></span>
              <StatusBadge status={r.status} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
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
          {v.prescriptions?.length > 0 && <p className="muted small">{v.prescriptions.map((r) => r.medicine_name).join(', ')}</p>}
        </div>
      ))}
    </Card>
  );
}

function VisitForm({ visitId }) {
  const { t } = useT();
  const toast = useToast();
  const { data: visit, error, loading, reload } = useAsync(() => api(`/visits/${visitId}`), [visitId]);
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!visit) return;
    setF({
      complaints: visit.complaints || '', examination_notes: visit.examination_notes || '', diagnosis: visit.diagnosis || '',
      advice: visit.advice || '', follow_up_date: visit.follow_up_date || '', consultation_fee: visit.consultation_fee ?? 0,
      bp: visit.vitals?.bp || '', pulse: visit.vitals?.pulse || '', temp: visit.vitals?.temp || '', weight: visit.vitals?.weight || '',
    });
    setLines(visit.prescriptions.length ? visit.prescriptions.map((p) => ({ ...p, key: String(p.id) })) : [emptyLine()]);
  }, [visit]);

  if (loading && !visit) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!f) return null;

  const locked = visit.issue_count > 0;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(complete) {
    setSaving(complete ? 'complete' : 'draft');
    try {
      const vitals = { bp: f.bp, pulse: f.pulse, temp: f.temp, weight: f.weight };
      const body = {
        complaints: f.complaints, examination_notes: f.examination_notes, diagnosis: f.diagnosis, advice: f.advice,
        follow_up_date: f.follow_up_date || null, consultation_fee: f.consultation_fee,
        vitals: Object.values(vitals).some(Boolean) ? vitals : null,
        complete,
      };
      if (!locked) body.prescriptions = lines.filter((l) => l.medicine_name.trim()).map(({ key, ...l }) => l);
      await api(`/visits/${visitId}`, { method: 'PUT', body });
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

      <Card title={t('examine.vitals')}>
        <div className="form-grid cols-4">
          <Input label={t('examine.bp')} placeholder="120/80" value={f.bp} onChange={set('bp')} />
          <Input label={t('examine.pulse')} inputMode="numeric" value={f.pulse} onChange={set('pulse')} />
          <Input label={t('examine.temp')} inputMode="decimal" value={f.temp} onChange={set('temp')} />
          <Input label={t('examine.weight')} inputMode="decimal" value={f.weight} onChange={set('weight')} />
        </div>
      </Card>

      <Card title={t('examine.clinical')}>
        <div className="form-grid">
          <TextArea label={t('examine.complaints')} value={f.complaints} onChange={set('complaints')} />
          <TextArea label={t('examine.examination')} value={f.examination_notes} onChange={set('examination_notes')} />
          <TextArea label={t('examine.diagnosis')} rows={2} value={f.diagnosis} onChange={set('diagnosis')} />
        </div>
      </Card>

      <Card title={t('examine.prescription')} actions={locked ? <Badge tone="info">{t('examine.rxLocked')}</Badge> : null}>
        <div className="rx-table">
          <div className="rx-row rx-head">
            <span>{t('examine.medicine')}</span><span>{t('examine.dosage')}</span><span>{t('examine.frequency')}</span>
            <span>{t('examine.duration')}</span><span>{t('examine.qty')}</span><span>{t('examine.instructions')}</span><span />
          </div>
          {lines.map((l) => (
            <div key={l.key} className="rx-row">
              {locked ? <span className="rx-locked">{l.medicine_name}</span> : (
                <ItemPicker value={l.medicine_name} ariaLabel={t('examine.medicine')} placeholder={t('examine.medicineHint')}
                  onPick={(p) => setLine(l.key, { medicine_name: p.medicine_name, item_id: p.item_id })} />
              )}
              <input aria-label={t('examine.dosage')} placeholder="4 pills" value={l.dosage || ''} disabled={locked} onChange={(e) => setLine(l.key, { dosage: e.target.value })} />
              <input aria-label={t('examine.frequency')} placeholder="1-0-1" value={l.frequency || ''} disabled={locked} onChange={(e) => setLine(l.key, { frequency: e.target.value })} />
              <input aria-label={t('examine.duration')} placeholder="7 days" value={l.duration || ''} disabled={locked} onChange={(e) => setLine(l.key, { duration: e.target.value })} />
              <input aria-label={t('examine.qty')} type="number" min="0" step="0.5" value={l.quantity} disabled={locked} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
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
  const visit = useAsync(() => (visitId ? api(`/visits/${visitId}`) : Promise.resolve(null)), [visitId]);

  return (
    <>
      <PageHeader title={t('menu.examine')} subtitle={auth.activeClinic?.name} />
      <div className="split">
        <div className="split-side">
          <QueuePanel currentVisitId={visitId} />
          {visit.data && <PastVisits patientId={visit.data.patient_id} excludeId={visit.data.id} />}
        </div>
        <div className="split-main">
          {visitId ? <VisitForm visitId={visitId} /> : <Card><Empty>{t('examine.pickPatient')}</Empty></Card>}
        </div>
      </div>
    </>
  );
}
