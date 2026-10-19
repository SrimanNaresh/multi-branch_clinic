// Examine → Prescription → Potency / Dosage: pick from the clinic's list for that kind.
// The bottom bar has "+ New" (pop-up to add one, typed text pre-filled), "Edit" (a pencil on each row:
// rename / change Order in the same pop-up) and "Delete" (a bin on each row, with a confirm pop-up).
// Edit / Delete stay on until "Done" or the list closes.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { cleanDosage, cleanOrder, MAX_ORDER, nextOrder } from '../../../shared/dosage.js';
import { Button, Input, Modal, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

/**
 * kind: 'potency' | 'dosage'
 * list: { rows: [text], added: [{ id, value, sort_order }] } from /api/visits/{kind}-options
 * onListChange(list) is called after an add or edit, so every line shares the new list.
 */
export default function RxListPicker({ kind, value, list, onChange, onListChange, disabled }) {
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);     // pop-up: { id (null = new), old, text, order, oldOrder }
  const [mode, setMode] = useState(null);           // null | 'edit' | 'delete' – row icons only in a mode
  const [removing, setRemoving] = useState(null);   // row waiting for delete confirmation
  const box = useRef(null);
  const name = t(`examine.${kind}`);                 // "Potency" / "Dosage"
  const url = `/visits/${kind}-options`;

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setMode(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const options = list.rows;
  const rowBy = new Map((list.added || []).map((a) => [a.value.toLowerCase(), a]));
  const typed = cleanDosage(value);
  const q = typed.toLowerCase();
  const shown = options.filter((o) => !q || o.toLowerCase().includes(q));
  const exact = options.some((o) => o.toLowerCase() === q);

  const pick = (v) => { onChange(v); setOpen(false); setMode(null); };
  const toggleMode = (m) => setMode((cur) => (cur === m ? null : m));

  async function remove() {
    setBusy(true);
    try {
      const r = await api(`${url}/${removing.id}`, { method: 'DELETE' });
      onListChange?.(r);
      toast(t('rxList.deleted', { value: removing.value }));
      setRemoving(null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const startNew = () => {
    setOpen(false);
    setEditing({ id: null, old: '', text: exact ? '' : typed, order: String(nextOrder(list.added || [])), oldOrder: null });
  };

  async function save(e) {
    e?.preventDefault();
    const oldValue = editing.old;
    const text = cleanDosage(editing.text);
    const order = cleanOrder(editing.order);
    if (!text) { toast(t('rxList.empty', { name }), 'error'); return; }
    if (order === null) { toast(t('rxList.orderBad', { max: MAX_ORDER }), 'error'); return; }
    if (editing.id && text === oldValue && order === editing.oldOrder) { setEditing(null); return; }
    setBusy(true);
    try {
      if (!editing.id) {                           // "+ New"
        const r = await api(url, { method: 'POST', body: { value: text, sort_order: order } });
        onListChange?.(r);
        onChange(r.value);
        setEditing(null);
        const isNew = r.added.some((a) => a.value === r.value && a.sort_order === order) && r.value.toLowerCase() === text.toLowerCase();
        toast(isNew ? t('rxList.added', { value: r.value }) : t('rxList.exists', { value: r.value }));
        return;
      }
      const r = await api(`${url}/${editing.id}`, { method: 'PUT', body: { value: text, sort_order: order } });
      onListChange?.(r);
      if (cleanDosage(value).toLowerCase() === oldValue.toLowerCase()) onChange(r.value);   // keep this line in step
      setEditing(null);
      toast(text === oldValue ? t('rxList.reordered', { value: r.value, n: order }) : t('rxList.renamed', { from: oldValue, to: r.value }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker rx-list-picker" ref={box}>
      <input className="combo-input" aria-label={name} placeholder={t('rxList.placeholder')} autoComplete="off"
        value={value || ''} disabled={disabled}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && open) { e.preventDefault(); if (typed && !exact) startNew(); else if (shown[0]) pick(shown[0]); }
        }} />
      {open && !disabled && (
        <ul className="picker-menu dosage-menu">
          {shown.map((o) => {
            const row = rowBy.get(o.toLowerCase());
            return (
              <li key={o} className="dosage-row">
                <button type="button" onClick={() => pick(o)}><span className="pick-title">{o}</span></button>
                {mode === 'edit' && row && (
                  <button type="button" className="icon-btn dosage-pencil" title={t('rxList.edit', { name })} aria-label={`${t('rxList.edit', { name })}: ${o}`}
                    onClick={() => { setOpen(false); setEditing({ id: row.id, old: o, text: o, order: String(row.sort_order), oldOrder: row.sort_order }); }}>
                    <Icon name="edit" size={14} />
                  </button>
                )}
                {mode === 'delete' && row && (
                  <button type="button" className="icon-btn dosage-pencil dosage-bin" title={t('rxList.delete', { name })} aria-label={`${t('rxList.delete', { name })}: ${o}`}
                    onClick={() => { setOpen(false); setRemoving({ id: row.id, value: o }); }}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </li>
            );
          })}
          <li className="dosage-bar">
            <button type="button" className="pick-add" onClick={startNew} title={t('rxList.new', { name })}>+ {t('rxList.newShort')}</button>
            <button type="button" className={`dosage-edit-toggle ${mode === 'edit' ? 'on' : ''}`} aria-pressed={mode === 'edit'}
              onClick={() => toggleMode('edit')}>
              {mode === 'edit' ? t('rxList.done') : <><Icon name="edit" size={13} /> {t('common.edit')}</>}
            </button>
            <button type="button" className={`dosage-edit-toggle danger ${mode === 'delete' ? 'on' : ''}`} aria-pressed={mode === 'delete'}
              onClick={() => toggleMode('delete')}>
              {mode === 'delete' ? t('rxList.done') : <><Icon name="trash" size={13} /> {t('rxList.deleteShort')}</>}
            </button>
          </li>
        </ul>
      )}

      {removing && (
        <Modal title={t('rxList.delete', { name })} onClose={() => !busy && setRemoving(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={remove} loading={busy}>{t('rxList.deleteShort')}</Button>
            </>
          )}>
          <div className="dosage-edit-form">
            <p>{t('rxList.deleteConfirm', { value: removing.value })}</p>
            <p className="muted small">{t('rxList.deleteHint')}</p>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={editing.id ? t('rxList.edit', { name }) : t('rxList.new', { name })} onClose={() => !busy && setEditing(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={save} loading={busy}>{t('common.save')}</Button>
            </>
          )}>
          <form onSubmit={save} className="dosage-edit-form">
            {editing.id && <p className="muted small">{t('rxList.current', { value: editing.old })}</p>}
            <div className="dosage-edit-fields">
              <Input label={name} required autoFocus maxLength={100} value={editing.text}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              <Input label={t('rxList.order')} required type="number" min="0" max={MAX_ORDER} step="1" inputMode="numeric"
                value={editing.order} onChange={(e) => setEditing({ ...editing, order: e.target.value })} />
            </div>
            <p className="muted small">{t('rxList.orderHint')}</p>
            {editing.id && <p className="muted small">{t('rxList.editHint')}</p>}
            <button type="submit" hidden />
          </form>
        </Modal>
      )}
    </div>
  );
}
