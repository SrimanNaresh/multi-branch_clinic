// Vital signs for one queue entry: the step after Confirm, editable later (reception and doctor).
// Rules live in shared/vitals.js so the API checks exactly the same thing.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { fmtDate } from '../lib/format.js';
import { bmi, checkVitals, VITAL_LIMITS } from '../../../shared/vitals.js';
import { Button, ErrorBox, Loading, Modal, useAsync, useToast } from './ui.jsx';
import Attachments from './Attachments.jsx';

const EMPTY = { height_cm: '', weight_kg: '', bp_systolic: '', bp_diastolic: '', pulse_bpm: '', temperature_c: '', comments: '' };

const toForm = (v) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v?.[k] ?? '']));

/** "BP 120/80 · Pulse 72 bpm · …" – one line for lists and history. */
export function vitalsSummary(v, t) {
  if (!v) return '';
  return [
    v.bp_systolic != null && `${t('vitals.bpShort')} ${v.bp_systolic}/${v.bp_diastolic}`,
    v.pulse_bpm != null && `${t('vitals.pulseShort')} ${v.pulse_bpm}`,
    v.temperature_c != null && `${v.temperature_c} °C`,
    v.weight_kg != null && `${v.weight_kg} kg`,
    v.height_cm != null && `${v.height_cm} cm`,
  ].filter(Boolean).join(' · ');
}

/**
 * `beforeActions`: shown under the fields and above Later / Save (outside the <form>, so pressing Enter
 * there does not save the vitals; the buttons still submit this form through form={formId}).
 */
export function VitalsForm({ queueId, initial, onSaved, onCancel, readOnly, beforeActions }) {
  const { t } = useT();
  const toast = useToast();
  const [f, setF] = useState(() => toForm(initial));
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setF(toForm(initial)); setTouched({}); setSubmitted(false); }, [initial]);

  const { errors } = checkVitals(f);
  const err = (k) => (submitted || touched[k]) && errors[k] && t(`vitals.err.${errors[k]}`);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const blur = (k) => () => setTouched((x) => ({ ...x, [k]: true }));
  const range = (k) => `${VITAL_LIMITS[k][0]}–${VITAL_LIMITS[k][1]}`;
  const b = bmi(checkVitals(f).data);

  async function save(e) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const { vitals } = await api(`/queue/${queueId}/vitals`, { method: 'PUT', body: f });
      toast(t('vitals.saved'));
      onSaved?.(vitals);
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const num = (k, label, unit, step) => (
    <label className="field">
      <span className="field-label">{label} <span className="muted">({unit})</span></span>
      <input type="number" inputMode="decimal" step={step} min={VITAL_LIMITS[k][0]} max={VITAL_LIMITS[k][1]}
        placeholder={range(k)} value={f[k]} onChange={set(k)} onBlur={blur(k)} disabled={readOnly}
        className={err(k) ? 'invalid' : ''} />
      {err(k) && <small className="field-error">{err(k)}</small>}
      {k === 'weight_kg' && b && !err(k) && <small className="muted">{t('vitals.bmi')} {b}</small>}
    </label>
  );

  const formId = `vitals-form-${queueId}`;
  return (
    <>
    <form id={formId} onSubmit={save} noValidate>
      <div className="form-grid vitals-grid">
        {num('height_cm', t('vitals.height'), 'cm', '0.1')}
        {num('weight_kg', t('vitals.weight'), 'kg', '0.1')}
        <label className="field">
          <span className="field-label">{t('vitals.bp')} <span className="muted">(mmHg)</span></span>
          <span className="bp-pair">
            <input type="number" inputMode="numeric" placeholder={t('vitals.sysShort')} aria-label={t('vitals.systolic')}
              value={f.bp_systolic} onChange={set('bp_systolic')} onBlur={blur('bp_systolic')} disabled={readOnly}
              className={err('bp_systolic') ? 'invalid' : ''} />
            <b>/</b>
            <input type="number" inputMode="numeric" placeholder={t('vitals.diaShort')} aria-label={t('vitals.diastolic')}
              value={f.bp_diastolic} onChange={set('bp_diastolic')} onBlur={blur('bp_diastolic')} disabled={readOnly}
              className={err('bp_diastolic') ? 'invalid' : ''} />
          </span>
          {(err('bp_systolic') || err('bp_diastolic')) && <small className="field-error">{err('bp_systolic') || err('bp_diastolic')}</small>}
        </label>
        {num('pulse_bpm', t('vitals.pulse'), 'bpm', '1')}
        {num('temperature_c', t('vitals.temperature'), '°C', '0.1')}
        <label className="field field-full">
          <span className="field-label">{t('vitals.comments')}</span>
          <textarea rows={1} maxLength={500} value={f.comments} onChange={set('comments')} disabled={readOnly} />
          {err('comments') && <small className="field-error">{err('comments')}</small>}
        </label>
      </div>
      {submitted && errors._form && <div className="alert alert-error">{t('vitals.err.empty')}</div>}
      {initial?.recorded_at && (
        <p className="muted small vitals-meta">
          {t('vitals.recordedBy', { name: initial.recorded_by_name || '—', at: fmtDate(initial.recorded_at, true) })}
          {initial.updated_at && ` · ${t('vitals.updatedBy', { name: initial.updated_by_name || '—', at: fmtDate(initial.updated_at, true) })}`}
        </p>
      )}
    </form>
    {beforeActions}
    {!readOnly && (
      <div className="form-actions">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>{t('vitals.later')}</Button>}
        <Button type="submit" form={formId} loading={saving}>{initial ? t('vitals.update') : t('vitals.save')}</Button>
      </div>
    )}
    </>
  );
}

/** Loads the vitals of a queue entry and lets you record / edit them in a dialog. */
export function VitalsModal({ entry, onClose, onSaved, readOnly }) {
  const { t } = useT();
  const current = useAsync(() => api(`/queue/${entry.id}/vitals`), [entry.id]);
  return (
    <Modal title={`${t('vitals.title')} – #${entry.token_no} ${entry.patient_name}`} onClose={onClose} wide>
      {current.loading && !current.data ? <Loading /> : <ErrorBox error={current.error} onRetry={current.reload} />}
      {current.data && (
        <VitalsForm queueId={entry.id} initial={current.data.vitals} onCancel={onClose} readOnly={readOnly}
          onSaved={(v) => { onSaved?.(v); onClose(); }}
          // lab reports & scans are saved on their own, right away – independent of Save below
          beforeActions={<Attachments entry={entry} canEdit={!readOnly} />} />
      )}
    </Modal>
  );
}
