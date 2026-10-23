// Examine → Complaints & diagnosis → 5. Comparative Study: one running table per patient
// (Date, Tine, Rt.H, Lt.H), so readings can be compared over time. Every visit shows all rows.
// + Add / Edit / Delete save right away (not with Save draft). readOnly: the table only (Patient History).
// Tine is a plain text box (saved in study_time); it may be left empty.
// Below the saved rows there are always 5 blank rows to type into: a filled row is saved when the
// cursor leaves it (Date defaults to today), and a fresh blank row takes its place.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { fmtDate, todayLocal } from '../lib/format.js';
import { checkComparative, MAX_READING, MAX_TIME } from '../../../shared/comparative.js';
import Icon from './Icon.jsx';
import { Button, ErrorBox, Input, Loading, Modal, useAsync, useToast } from './ui.jsx';

const BLANK_ROWS = 5;
let draftSeq = 0;
const blankRow = () => ({ key: `d${++draftSeq}`, study_date: '', study_time: '', rt_h: '', lt_h: '', saving: false });



export default function ComparativeStudy({ patientId, visitId, onCount, readOnly = false }) {
  const { t } = useT();
  const toast = useToast();
  const list = useAsync(() => api(`/visits/patient/${patientId}/comparative`), [patientId]);
  const [changed, setChanged] = useState(null);     // rows after an add / edit / delete
  const [editing, setEditing] = useState(null);     // { id (null = new), study_date, study_time, rt_h, lt_h }
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState(() => Array.from({ length: BLANK_ROWS }, blankRow));
  const rows = changed || list.data?.rows || [];

  useEffect(() => { onCount?.(rows.length); }, [rows.length, onCount]);

  if (readOnly && !rows.length) return null;

  const setDraft = (key, patch) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  // a blank row being typed into: saved when the cursor leaves the row and Rt.H or Lt.H is filled
  async function saveDraft(d) {
    if (d.saving || (!d.rt_h.trim() && !d.lt_h.trim())) return;
    const body = { study_date: d.study_date || todayLocal(), study_time: d.study_time, rt_h: d.rt_h, lt_h: d.lt_h };
    const { error } = checkComparative(body);
    if (error) { toast(t(`cs.err.${error}`), 'error'); return; }
    setDraft(d.key, { saving: true });
    try {
      const r = await api(`/visits/patient/${patientId}/comparative`, { method: 'POST', body: { ...body, visit_id: visitId } });
      setChanged(r.rows);
      setDrafts((ds) => [...ds.filter((x) => x.key !== d.key), blankRow()]);
      toast(t('cs.saved'));
    } catch (err) {
      setDraft(d.key, { saving: false });
      toast(err.message, 'error');
    }
  }
  const leaveRow = (d) => (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;   // still inside the same row
    saveDraft(d);
  };

  async function save(e) {
    e?.preventDefault();
    const { error } = checkComparative(editing);
    if (error) { toast(t(`cs.err.${error}`), 'error'); return; }
    setBusy(true);
    try {
      const body = { study_date: editing.study_date, study_time: editing.study_time, rt_h: editing.rt_h, lt_h: editing.lt_h };
      const r = editing.id
        ? await api(`/visits/comparative/${editing.id}`, { method: 'PUT', body })
        : await api(`/visits/patient/${patientId}/comparative`, { method: 'POST', body: { ...body, visit_id: visitId } });
      setChanged(r.rows);
      setEditing(null);
      toast(t('cs.saved'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api(`/visits/comparative/${removing.id}`, { method: 'DELETE' });
      setChanged(r.rows);
      setRemoving(null);
      toast(t('cs.deleted'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const field = (k) => ({ value: editing[k] || '', onChange: (e) => setEditing({ ...editing, [k]: e.target.value }) });

  return (
    <div className="cs">
      <div className="dosdont-head">
        <h3>{t('cs.title')}</h3>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={() => setEditing({ id: null, study_date: todayLocal(), study_time: '', rt_h: '', lt_h: '' })}>
            <Icon name="plus" size={14} /> {t('cs.add')}
          </Button>
        )}
      </div>

      {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
      {readOnly && list.data && !rows.length && <p className="muted small">{t('cs.empty')}</p>}
      {(rows.length > 0 || (!readOnly && list.data)) && (
        <div className="table-wrap cs-table">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>#</th><th>{t('cs.date')}</th><th>{t('cs.tine')}</th><th>{t('cs.rt')}</th><th>{t('cs.lt')}</th>
                {!readOnly && <th className="col-actions" aria-label={t('common.edit')} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{fmtDate(r.study_date)}</td>
                  <td>{r.study_time || '—'}</td>
                  <td>{r.rt_h || '—'}</td>
                  <td>{r.lt_h || '—'}</td>
                  {!readOnly && (
                    <td className="col-actions">
                      <button type="button" className="icon-btn dosdont-icon" title={t('cs.edit')} aria-label={`${t('cs.edit')}: ${fmtDate(r.study_date)}`}
                        onClick={() => setEditing({ id: r.id, study_date: r.study_date, study_time: r.study_time || '', rt_h: r.rt_h || '', lt_h: r.lt_h || '' })}>
                        <Icon name="edit" size={14} />
                      </button>
                      <button type="button" className="icon-btn dosdont-icon danger" title={t('cs.delete')} aria-label={`${t('cs.delete')}: ${fmtDate(r.study_date)}`}
                        onClick={() => setRemoving(r)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!readOnly && list.data && drafts.map((d, i) => (
                <tr key={d.key} className="cs-draft" onBlur={leaveRow(d)}>
                  <td>{rows.length + i + 1}</td>
                  <td><input type="date" value={d.study_date} aria-label={`${t('cs.date')} ${rows.length + i + 1}`} disabled={d.saving}
                    onChange={(e) => setDraft(d.key, { study_date: e.target.value })} /></td>
                  <td><input value={d.study_time} maxLength={MAX_TIME} aria-label={`${t('cs.tine')} ${rows.length + i + 1}`}
                    disabled={d.saving} onChange={(e) => setDraft(d.key, { study_time: e.target.value })} /></td>
                  <td><input value={d.rt_h} maxLength={MAX_READING} aria-label={`${t('cs.rt')} ${rows.length + i + 1}`} disabled={d.saving}
                    onChange={(e) => setDraft(d.key, { rt_h: e.target.value, study_date: d.study_date || todayLocal() })} /></td>
                  <td><input value={d.lt_h} maxLength={MAX_READING} aria-label={`${t('cs.lt')} ${rows.length + i + 1}`} disabled={d.saving}
                    onChange={(e) => setDraft(d.key, { lt_h: e.target.value, study_date: d.study_date || todayLocal() })} /></td>
                  <td className="col-actions" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && <p className="muted small dosdont-hint">{t('cs.hint')}</p>}

      {editing && (
        <Modal title={editing.id ? t('cs.edit') : t('cs.new')} onClose={() => !busy && setEditing(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={save} loading={busy}>{t('common.save')}</Button>
            </>
          )}>
          <form onSubmit={save} className="form-grid cs-form">
            <Input label={t('cs.date')} type="date" required {...field('study_date')} />
            <Input label={t('cs.tine')} maxLength={MAX_TIME} {...field('study_time')} />
            <Input label={t('cs.rt')} maxLength={MAX_READING} autoFocus {...field('rt_h')} />
            <Input label={t('cs.lt')} maxLength={MAX_READING} {...field('lt_h')} />
            <button type="submit" hidden />
          </form>
        </Modal>
      )}

      {removing && (
        <Modal title={t('cs.delete')} onClose={() => !busy && setRemoving(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={remove} loading={busy}>{t('rxList.deleteShort')}</Button>
            </>
          )}>
          <p>{t('cs.deleteConfirm', { date: `${fmtDate(removing.study_date)}${removing.study_time ? `, ${removing.study_time}` : ''}` })}</p>
        </Modal>
      )}
    </div>
  );
}
