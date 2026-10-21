// Examine → Advice → Do's and Don'ts: the clinic's list (Smoking, Alcohol, …) with a Do / Don't choice per item.
// Clicking the chosen button again clears it; only marked items are saved with the visit.
// "+ New", "Edit" and "Delete" change the clinic's list (same pop-ups as Potency / Dosage).
// A marked item that was later deleted from the list still shows, so the visit keeps it.
import { useState } from 'react';
import { useT } from '../lib/i18n.jsx';
import Icon from './Icon.jsx';
import { editListRow, ListTools, newListRow, RxListModals } from './RxListPicker.jsx';

/**
 * list: { rows: [text], added: [{ id, value, sort_order }] } from /api/visits/dosdont-options
 * marks: [{ item, rule: 'do' | 'dont' }]; onChange(marks)
 */
export default function DosDontList({ list, onListChange, marks, onChange }) {
  const { t } = useT();
  const [mode, setMode] = useState(null);           // null | 'edit' | 'delete' – row icons only in a mode
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [q, setQ] = useState('');                   // filter: text in the item name
  const [show, setShow] = useState('all');          // filter: 'all' | 'do' | 'dont'
  const name = t('examine.dosdont');

  const key = (s) => s.toLowerCase();
  const ruleOf = new Map(marks.map((m) => [key(m.item), m.rule]));
  const rowBy = new Map((list.added || []).map((a) => [key(a.value), a]));
  const listed = new Set(list.rows.map(key));
  const shown = [...list.rows, ...marks.map((m) => m.item).filter((i) => !listed.has(key(i)))];
  const text = key(q.trim());
  const visible = shown.filter((i) => (!text || key(i).includes(text)) && (show === 'all' || ruleOf.get(key(i)) === show));
  const count = { all: shown.length, do: marks.filter((m) => m.rule === 'do').length, dont: marks.filter((m) => m.rule === 'dont').length };

  const setRule = (item, rule) => {
    const rest = marks.filter((m) => key(m.item) !== key(item));
    onChange(ruleOf.get(key(item)) === rule ? rest : [...rest, { item, rule }]);
  };

  return (
    <div className="dosdont">
      <div className="dosdont-head">
        <h3>{t('examine.dosDonts')}</h3>
        <ListTools mode={mode} setMode={setMode} onNew={() => setEditing(newListRow(list))} />
      </div>

      {shown.length > 0 && (
        <div className="dosdont-filter">
          <span className="dosdont-search">
            <Icon name="search" size={14} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('examine.dosDontsFilter')} aria-label={t('examine.dosDontsFilter')} />
          </span>
          <div className="dosdont-show" role="group" aria-label={t('examine.dosDontsShow')}>
            {[['all', t('common.all')], ['do', t('examine.do')], ['dont', t('examine.dont')]].map(([k, label]) => (
              <button key={k} type="button" className={`${k} ${show === k ? 'on' : ''}`} aria-pressed={show === k} onClick={() => setShow(k)}>
                {label} <span className="dosdont-count">{count[k]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 && <p className="muted small">{t('examine.dosDontsEmpty')}</p>}
      {shown.length > 0 && (
        <ul className="dosdont-list">
          {visible.length === 0 && <li className="dosdont-none muted small">{t('examine.dosDontsNoMatch')}</li>}
          {visible.map((item) => {
            const rule = ruleOf.get(key(item));
            const row = rowBy.get(key(item));
            return (
              <li key={key(item)} className={`dosdont-row ${rule ? `is-${rule}` : ''}`}>
                <span className="dosdont-item">{item}</span>
                {mode === 'edit' && row && (
                  <button type="button" className="icon-btn dosdont-icon" title={t('rxList.edit', { name })} aria-label={`${t('rxList.edit', { name })}: ${item}`}
                    onClick={() => setEditing(editListRow(row))}>
                    <Icon name="edit" size={14} />
                  </button>
                )}
                {mode === 'delete' && row && (
                  <button type="button" className="icon-btn dosdont-icon danger" title={t('rxList.delete', { name })} aria-label={`${t('rxList.delete', { name })}: ${item}`}
                    onClick={() => setRemoving({ id: row.id, value: row.value })}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
                <div className="dosdont-seg" role="group" aria-label={item}>
                  <button type="button" className={`do ${rule === 'do' ? 'on' : ''}`} aria-pressed={rule === 'do'} onClick={() => setRule(item, 'do')}>
                    <Icon name="check" size={12} /> {t('examine.do')}
                  </button>
                  <button type="button" className={`dont ${rule === 'dont' ? 'on' : ''}`} aria-pressed={rule === 'dont'} onClick={() => setRule(item, 'dont')}>
                    <Icon name="x" size={12} /> {t('examine.dont')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small dosdont-hint">{t('examine.dosDontsHint')}</p>

      <RxListModals kind="dosdont" name={name} list={list} onListChange={onListChange}
        editing={editing} setEditing={setEditing} removing={removing} setRemoving={setRemoving}
        onRenamed={(from, to) => onChange(marks.map((m) => (key(m.item) === key(from) ? { ...m, item: to } : m)))} />
    </div>
  );
}

/** Saved marks as two short lines for history: Do: … / Don't: … */
export function DosDontSummary({ marks }) {
  const { t } = useT();
  const dos = marks.filter((m) => m.rule === 'do').map((m) => m.item);
  const donts = marks.filter((m) => m.rule === 'dont').map((m) => m.item);
  return (
    <>
      {dos.length > 0 && <div><dt>{t('examine.do')}</dt><dd>{dos.join(', ')}</dd></div>}
      {donts.length > 0 && <div><dt>{t('examine.dont')}</dt><dd>{donts.join(', ')}</dd></div>}
    </>
  );
}
