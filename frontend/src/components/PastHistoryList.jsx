// Examine → Complaints & diagnosis: a tick + note list, used twice (kind):
//   'pasthistory' – Examination History (ENT, Ortho, Dental, …), with questions per item
//   'medhistory'  – Medical History (Smoking, Alcohol, Tobacco, …), how long (text + Months / Years) instead of
//                   a note, no questions
// Tick what applies to the patient and add a short note; it is saved with this visit. A visit never
// saved starts from the patient's previous visit (copiedFrom = that visit's date).
// "+ New", "Edit" and "Delete" change the clinic's list (same pop-ups as Potency).
// A ticked item that was later deleted from the list still shows, so the patient keeps it.
// Examination History only: ticking an item also shows its questions (ENT → Symptom Character, …) with a
// short answer each; every item has its own question list with + New / Edit / Delete.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { fmtDate } from '../lib/format.js';
import { DURATION_UNITS, MAX_PAST_ANSWER, MAX_PAST_DURATION, MAX_PAST_NOTE } from '../../../shared/pastHistory.js';
import Icon from './Icon.jsx';
import { useAsync } from './ui.jsx';
import { editListRow, ListTools, newListRow, RxListModals } from './RxListPicker.jsx';

const KIND_TEXT = {
  pasthistory: { title: 'examine.pastHistory', note: 'examine.pastNote', hint: 'examine.pastHint' },
  medhistory: { title: 'examine.medicalHistory', note: 'examine.medNote', hint: 'examine.medHint' },
};

/**
 * list: { rows: [text], added: [{ id, value, sort_order }] } from /api/visits/{kind}-options
 * value: [{ item, note, answers?: [{ q, a }] }]; onChange(value)
 */
export default function PastHistoryList({ kind = 'pasthistory', list, onListChange, value, onChange, copiedFrom }) {
  const { t } = useT();
  const [mode, setMode] = useState(null);           // null | 'edit' | 'delete' – row icons only in a mode
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [q, setQ] = useState('');                   // filter: text in the item name
  const [show, setShow] = useState('all');          // filter: 'all' | 'ticked'
  const name = t(`examine.${kind}`);
  const text_ = KIND_TEXT[kind];
  const withQuestions = kind === 'pasthistory';
  // every item's questions { [itemId]: { rows, added } }; replaced per item after an add / edit / delete
  const questions = useAsync(() => (withQuestions ? api('/visits/pasthistory-questions') : Promise.resolve({})), [withQuestions]);
  const [qChanged, setQChanged] = useState({});
  const qmap = { ...(questions.data || {}), ...qChanged };

  const key = (s) => s.toLowerCase();
  const noteOf = new Map(value.map((h) => [key(h.item), h.note]));
  const rowBy = new Map((list.added || []).map((a) => [key(a.value), a]));
  const listed = new Set(list.rows.map(key));
  const shown = [...list.rows, ...value.map((h) => h.item).filter((i) => !listed.has(key(i)))];
  const text = key(q.trim());
  const visible = shown.filter((i) => (!text || key(i).includes(text)) && (show === 'all' || noteOf.has(key(i))));
  const count = { all: shown.length, ticked: value.length };

  const toggle = (item) => onChange(noteOf.has(key(item))
    ? value.filter((h) => key(h.item) !== key(item))
    : [...value, { item, note: '' }]);
  const setNote = (item, note) => onChange(value.map((h) => (key(h.item) === key(item) ? { ...h, note } : h)));
  const withDuration = kind === 'medhistory';
  const rowOf = (item) => value.find((h) => key(h.item) === key(item)) || {};
  const setField = (item, patch) => onChange(value.map((h) => (key(h.item) === key(item) ? { ...h, ...patch } : h)));
  const answersOf = (item) => value.find((h) => key(h.item) === key(item))?.answers || [];
  const setAnswers = (item, answers) => onChange(value.map((h) => (key(h.item) === key(item) ? { ...h, answers } : h)));

  return (
    <div className={`dosdont ${kind}`}>
      <div className="dosdont-head">
        <h3>{t(text_.title)}</h3>
        <ListTools mode={mode} setMode={setMode} onNew={() => setEditing(newListRow(list))} />
      </div>
      {copiedFrom && <p className="ph-copied small">{t('examine.pastCopied', { date: fmtDate(copiedFrom) })}</p>}

      {shown.length > 0 && (
        <div className="dosdont-filter">
          <span className="dosdont-search">
            <Icon name="search" size={14} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('examine.dosDontsFilter')} aria-label={t('examine.dosDontsFilter')} />
          </span>
          <div className="dosdont-show" role="group" aria-label={t('examine.dosDontsShow')}>
            {[['all', t('common.all')], ['ticked', t('examine.pastTicked')]].map(([k, label]) => (
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
            const ticked = noteOf.has(key(item));
            const row = rowBy.get(key(item));
            return (
              <li key={key(item)} className={`dosdont-row ph-row ${ticked ? 'is-on' : ''}`}>
                <label className="ph-check">
                  <input type="checkbox" checked={ticked} onChange={() => toggle(item)} />
                  <span className="dosdont-item">{item}</span>
                </label>
                {ticked && withDuration && (
                  <span className="ph-duration">
                    <input className="ph-dur" value={rowOf(item).dur || ''} maxLength={MAX_PAST_DURATION} inputMode="numeric"
                      placeholder={t('examine.durationPh')} aria-label={`${item}: ${t('examine.howLong')}`}
                      onChange={(e) => setField(item, { dur: e.target.value, unit: rowOf(item).unit || 'years' })} />
                    <select className="ph-unit" value={rowOf(item).unit || 'years'} aria-label={`${item}: ${t('examine.durationUnit')}`}
                      onChange={(e) => setField(item, { unit: e.target.value })}>
                      {DURATION_UNITS.map((u) => <option key={u} value={u}>{t(`examine.unit.${u}`)}</option>)}
                    </select>
                  </span>
                )}
                {ticked && !withDuration && (
                  <input className="ph-note" value={noteOf.get(key(item))} maxLength={MAX_PAST_NOTE}
                    placeholder={t(text_.note)} aria-label={`${item}: ${t(text_.note)}`}
                    onChange={(e) => setNote(item, e.target.value)} />
                )}
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
                {withQuestions && ticked && (row || answersOf(item).length > 0) && (
                  <PastQuestions item={item} itemId={row?.id}
                    qlist={(row && qmap[row.id]) || { rows: [], added: [] }} loading={!!row && !qmap[row.id] && questions.loading}
                    onQListChange={(r) => setQChanged((m) => ({ ...m, [row.id]: { rows: r.rows, added: r.added } }))}
                    answers={answersOf(item)} onAnswers={(answers) => setAnswers(item, answers)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small dosdont-hint">{t(text_.hint)}</p>

      <RxListModals kind={kind} name={name} list={list} onListChange={onListChange}
        editing={editing} setEditing={setEditing} removing={removing} setRemoving={setRemoving}
        onRenamed={(from, to) => onChange(value.map((h) => (key(h.item) === key(from) ? { ...h, item: to } : h)))} />
    </div>
  );
}

/**
 * One ticked item's questions with a short answer each. Questions come from the item's list; an answer
 * whose question was later deleted still shows, so the patient keeps it.
 */
function PastQuestions({ item, itemId, qlist, loading, onQListChange, answers, onAnswers }) {
  const { t } = useT();
  const [mode, setMode] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const name = t('examine.question');

  const key = (s) => s.toLowerCase();
  const answerOf = new Map(answers.map((x) => [key(x.q), x.a]));
  const rowBy = new Map((qlist.added || []).map((a) => [key(a.value), a]));
  const listed = new Set(qlist.rows.map(key));
  const qs = [...qlist.rows, ...answers.map((x) => x.q).filter((q) => !listed.has(key(q)))];

  const setAnswer = (q, a) => {
    const rest = answers.filter((x) => key(x.q) !== key(q));
    onAnswers(a ? [...rest, { q, a }] : rest);
  };

  return (
    <div className="ph-questions">
      <div className="phq-head">
        <span>{t('examine.pastQuestions', { item })}</span>
        {itemId && <ListTools mode={mode} setMode={setMode} onNew={() => setEditing(newListRow(qlist))} />}
      </div>
      {loading && <p className="muted small">{t('common.loading')}</p>}
      {!loading && qs.length === 0 && <p className="muted small">{t('examine.pastNoQuestions')}</p>}
      {qs.map((q) => {
        const row = rowBy.get(key(q));
        return (
          <div key={key(q)} className="phq-row">
            <label htmlFor={`phq-${itemId}-${key(q)}`}>{q}</label>
            <input id={`phq-${itemId}-${key(q)}`} value={answerOf.get(key(q)) ?? ''} maxLength={MAX_PAST_ANSWER}
              onChange={(e) => setAnswer(q, e.target.value)} />
            {mode === 'edit' && row && (
              <button type="button" className="icon-btn dosdont-icon" title={t('rxList.edit', { name })} aria-label={`${t('rxList.edit', { name })}: ${q}`}
                onClick={() => setEditing(editListRow(row))}>
                <Icon name="edit" size={14} />
              </button>
            )}
            {mode === 'delete' && row && (
              <button type="button" className="icon-btn dosdont-icon danger" title={t('rxList.delete', { name })} aria-label={`${t('rxList.delete', { name })}: ${q}`}
                onClick={() => setRemoving({ id: row.id, value: row.value })}>
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
        );
      })}
      {itemId && (
        <RxListModals kind="pasthistory-question" url={`/visits/pasthistory-questions/${itemId}`} name={name} list={qlist}
          onListChange={onQListChange} editing={editing} setEditing={setEditing} removing={removing} setRemoving={setRemoving}
          onRenamed={(from, to) => onAnswers(answers.map((x) => (key(x.q) === key(from) ? { ...x, q: to } : x)))} />
      )}
    </div>
  );
}

/** A patient's past history to read: each ticked item with its note, then its answered questions. */
export function PastHistorySummary({ value = [] }) {
  const { t } = useT();
  return (
    <div className="ph-summary">
      {value.map((h) => (
        <div key={h.item} className="ph-summary-item">
          <div className="ph-summary-head">
            <Icon name="check" size={14} /> <b>{h.item}</b>
            {h.dur && <span className="muted"> – {h.dur} {t(`examine.unit.${h.unit || 'years'}`)}</span>}
            {h.note && <span className="muted"> – {h.note}</span>}
          </div>
          {h.answers?.length > 0 && (
            <dl className="pv-fields">
              {h.answers.map((x) => <div key={x.q}><dt>{x.q}</dt><dd>{x.a}</dd></div>)}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
