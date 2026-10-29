// Examine → Prescription → Potency / Dosage: pick from the clinic's list for that kind.
// The bottom bar has "+ New" (pop-up to add one, typed text pre-filled), "Edit" (a pencil on each row:
// rename / change Order in the same pop-up) and "Delete" (a bin on each row, with a confirm pop-up).
// Edit / Delete stay on until "Done" or the list closes.
// Keyboard: ↑ / ↓ move through the list, Enter picks (or "+ New" for unlisted text), Esc closes.
// `multiple` (Day Book → Routine): value is an array; clicking a row ticks / unticks it and the list
// stays open; the box shows the ticked ones ("Walking, Yoga") and, while open, filters as you type.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { cleanDosage, cleanOrder, MAX_ORDER, nextOrder } from '../../../shared/dosage.js';
import { Button, Input, Modal, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

/**
 * kind: 'potency' | 'dosage' | … (also 'generic' / 'manufacturer' for Pharmacy → Item)
 * label: the list's name when it is not examine.<kind> (e.g. "Generic Name")
 * list: { rows: [text], added: [{ id, value, sort_order }] } from /api/visits/{kind}-options
 * onListChange(list) is called after an add or edit, so every line shares the new list.
 */
export default function RxListPicker({ kind, label, value, list, onChange, onListChange, disabled, multiple = false }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);     // pop-up: { id (null = new), old, text, order, oldOrder }
  const [mode, setMode] = useState(null);           // null | 'edit' | 'delete' – row icons only in a mode
  const [removing, setRemoving] = useState(null);   // row waiting for delete confirmation
  const [active, setActive] = useState(-1);         // highlighted row, -1 = none
  const [filter, setFilter] = useState('');         // multiple: text typed to filter the list
  const box = useRef(null);
  const menu = useRef(null);
  const menuId = useId();
  const name = label || t(`examine.${kind}`);        // "Potency" / "Dosage"

  useEffect(() => {
    const outside = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setMode(null); setFilter(''); } };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  const options = list.rows;
  const rowBy = new Map((list.added || []).map((a) => [a.value.toLowerCase(), a]));
  const picked = multiple ? (value || []) : null;
  const isPicked = (o) => picked.some((p) => p.toLowerCase() === o.toLowerCase());
  const typed = cleanDosage(multiple ? filter : value);
  const q = typed.toLowerCase();
  const shown = options.filter((o) => !q || o.toLowerCase().includes(q));
  const exact = options.some((o) => o.toLowerCase() === q);
  const showMenu = open && !disabled;

  // list changed or reopened: nothing highlighted until an arrow key is pressed
  const shownKey = shown.join('\n');
  useEffect(() => setActive(-1), [shownKey, open]);
  // keep the highlighted row visible inside the scrolling menu
  useEffect(() => {
    if (active >= 0) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showMenu) { setOpen(true); return; }
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? shown.length - 1 : (a + step + shown.length) % shown.length));
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active >= 0 && shown[active]) pick(shown[active]);
      else if (typed && !exact) startNew();
      else if (shown[0]) pick(shown[0]);
    }
  };

  const pick = (v) => {
    if (multiple) {                                 // tick / untick, keep the list open
      onChange(isPicked(v) ? picked.filter((p) => p.toLowerCase() !== v.toLowerCase()) : [...picked, v]);
      setFilter('');
      return;
    }
    onChange(v); setOpen(false); setMode(null);
  };
  const close = () => { setOpen(false); setMode(null); setFilter(''); };
  const toggleMode = (m) => setMode((cur) => (cur === m ? null : m));

  const startNew = () => {
    setOpen(false);
    setEditing(newListRow(list, exact ? '' : typed));
  };

  return (
    <div className="picker rx-list-picker" ref={box}>
      <input className="combo-input" aria-label={name} placeholder={t('rxList.placeholder')} autoComplete="off"
        value={multiple ? (showMenu ? filter : picked.join(', ')) : value || ''} disabled={disabled}
        title={multiple ? picked.join(', ') : undefined}
        role="combobox" aria-expanded={showMenu} aria-controls={menuId} aria-autocomplete="list"
        aria-activedescendant={showMenu && active >= 0 ? `${menuId}-${active}` : undefined}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { if (multiple) setFilter(e.target.value); else onChange(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown} />
      {showMenu && (
        <ul className="picker-menu dosage-menu" id={menuId} ref={menu}>
          {shown.map((o, idx) => {
            const row = rowBy.get(o.toLowerCase());
            return (
              <li key={o} className="dosage-row" id={`${menuId}-${idx}`}>
                <button type="button" tabIndex={-1} className={idx === active ? 'active' : ''}
                  aria-selected={multiple ? isPicked(o) : undefined}
                  onMouseEnter={() => setActive(idx)} onClick={() => pick(o)}>
                  {multiple && <input type="checkbox" className="pick-check" tabIndex={-1} readOnly checked={isPicked(o)} />}
                  <span className="pick-title">{o}</span>
                </button>
                {mode === 'edit' && row && (
                  <button type="button" className="icon-btn dosage-pencil" title={t('rxList.edit', { name })} aria-label={`${t('rxList.edit', { name })}: ${o}`}
                    onClick={() => { setOpen(false); setEditing(editListRow(row)); }}>
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

      <RxListModals kind={kind} name={name} list={list} onListChange={onListChange}
        editing={editing} setEditing={setEditing} removing={removing} setRemoving={setRemoving}
        onAdded={(v) => (multiple ? !isPicked(v) && onChange([...picked, v]) : onChange(v))}
        onRenamed={(from, to) => {
          if (multiple) onChange(picked.map((p) => (p.toLowerCase() === from.toLowerCase() ? to : p)));
          else if (cleanDosage(value).toLowerCase() === from.toLowerCase()) onChange(to);
        }} />
    </div>
  );
}

/** "+ New" / "Edit" / "Delete" buttons above a list box; Edit and Delete switch a mode (Done ends it). */
export function ListTools({ mode, setMode, onNew }) {
  const { t } = useT();
  const toggle = (m) => setMode((cur) => (cur === m ? null : m));
  return (
    <div className="dosdont-tools">
      <Button variant="ghost" size="sm" onClick={() => { setMode(null); onNew(); }}>
        <Icon name="plus" size={14} /> {t('rxList.newShort')}
      </Button>
      <Button variant="ghost" size="sm" className={mode === 'edit' ? 'on' : ''} aria-pressed={mode === 'edit'} onClick={() => toggle('edit')}>
        {mode === 'edit' ? t('rxList.done') : <><Icon name="edit" size={13} /> {t('common.edit')}</>}
      </Button>
      <Button variant="ghost" size="sm" className={mode === 'delete' ? 'on danger' : ''} aria-pressed={mode === 'delete'} onClick={() => toggle('delete')}>
        {mode === 'delete' ? t('rxList.done') : <><Icon name="trash" size={13} /> {t('rxList.deleteShort')}</>}
      </Button>
    </div>
  );
}

/** Pop-up state for "+ New": text pre-filled, Order after the last row. */
export const newListRow = (list, text = '') => ({ id: null, old: '', text, order: String(nextOrder(list.added || [])), oldOrder: null });
/** Pop-up state for editing a row of list.added. */
export const editListRow = (row) => ({ id: row.id, old: row.value, text: row.value, order: String(row.sort_order), oldOrder: row.sort_order });

/**
 * The "+ New" / Edit pop-up and the Delete confirm for one list kind (shared by the prescription
 * pickers and the Do's and Don'ts list). editing / removing are owned by the caller:
 * editing = { id (null = new), old, text, order, oldOrder }, removing = { id, value }.
 * onAdded(value) after "+ New"; onRenamed(from, to) after a rename.
 * url: the list's API (default /visits/{kind}-options); it answers with { value?, rows, added }.
 */
export function RxListModals({ kind, url: listUrl, name, list, onListChange, editing, setEditing, removing, setRemoving, onAdded, onRenamed }) {
  const { t } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = listUrl || `/visits/${kind}-options`;

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
        onAdded?.(r.value);
        setEditing(null);
        const isNew = r.added.some((a) => a.value === r.value && a.sort_order === order) && r.value.toLowerCase() === text.toLowerCase();
        toast(isNew ? t('rxList.added', { value: r.value }) : t('rxList.exists', { value: r.value }));
        return;
      }
      const r = await api(`${url}/${editing.id}`, { method: 'PUT', body: { value: text, sort_order: order } });
      onListChange?.(r);
      onRenamed?.(oldValue, r.value);              // keep what was picked in step
      setEditing(null);
      toast(text === oldValue ? t('rxList.reordered', { value: r.value, n: order }) : t('rxList.renamed', { from: oldValue, to: r.value }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
    </>
  );
}
