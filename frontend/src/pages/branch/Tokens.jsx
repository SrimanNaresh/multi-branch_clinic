// Patient & Queue → Tokens: today's tokens per doctor, made from their time slots (Employee → Time slots).
// Click an available token to book a patient into the queue for that doctor and time.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { toMinutes } from '../../../../shared/timeSlots.js';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, SearchBox, Select, StatusBadge, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsModal } from '../../components/VitalSigns.jsx';

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Short patient registration inside the booking dialog: register, then the slot is booked right away. */
function NewPatientForm({ token, initial, onRegistered, onBookExisting, onBack }) {
  const { t } = useT();
  const [f, setF] = useState({ name: '', mobile: '', gender: '', age_years: '', city: '', ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e, force = false) {
    e?.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...f, age_years: f.age_years === '' ? null : Number(f.age_years), gender: f.gender || null, force };
      const patient = await api('/patients', { method: 'POST', body });
      await onRegistered(patient);
    } catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE') setDuplicate(err.details || []);
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <Input label={t('field.name')} required autoFocus value={f.name} onChange={set('name')} />
        <Input label={t('field.mobile')} required type="tel" inputMode="tel" value={f.mobile} onChange={set('mobile')} />
        <Select label={t('field.gender')} value={f.gender} onChange={set('gender')} placeholder="—"
          options={['M', 'F', 'O'].map((g) => ({ value: g, label: t(`gender.${g}`) }))} />
        <Input label={t('field.age')} type="number" min="0" max="130" inputMode="numeric" value={f.age_years} onChange={set('age_years')} />
        <Input label={t('field.city')} value={f.city} onChange={set('city')} />
      </div>
      {duplicate && (
        <div className="alert alert-warning">
          {t('patients.possibleDuplicate')}
          <ul className="result-list">
            {duplicate.map((d) => (
              <li key={d.id}>
                <span>{d.patient_code} – {d.name} ({d.mobile})</span>
                <Button type="button" size="sm" onClick={() => onBookExisting(d)}>{t('tokens.book')}</Button>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="ghost" loading={saving} onClick={() => submit(null, true)}>{t('patients.registerAnyway')}</Button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      <p className="muted small">{t('tokens.newPatientHint')}</p>
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={onBack}>{t('tokens.backToSearch')}</Button>
        <Button type="submit" loading={saving}>{t('tokens.registerAndBook', { time: token.start })}</Button>
      </div>
    </form>
  );
}

/** Search a patient and book them into one token (or give a waiting patient this slot), or register a new patient. */
function BookDialog({ doctor, token, onClose, onBooked }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [busy, setBusy] = useState(null);
  const [newPatient, setNewPatient] = useState(false);
  const results = useAsync(() => (dq.trim() ? api('/queue/search', { query: { q: dq.trim() } }) : Promise.resolve({ rows: [] })), [dq]);
  const canRegister = auth.can('patient.create');
  // what was typed in the search box goes into the new-patient form
  const typed = q.trim();
  const initial = /^[+\d\s-]{6,}$/.test(typed) ? { mobile: typed.replace(/\s/g, '') } : { name: typed };

  async function book(p) {
    setBusy(p.id);
    try {
      const entry = p.queue_id
        ? await api(`/queue/${p.queue_id}/slot`, { method: 'PATCH', body: { doctor_id: doctor.id, slot_time: token.start } })
        : await api('/queue', { method: 'POST', body: { patient_id: p.id, doctor_id: doctor.id, slot_time: token.start, visit_type: p.last_visit ? 'follow_up' : 'new' } });
      toast(t('tokens.booked', { time: token.start, name: entry.patient_name, n: entry.token_no }));
      onBooked(entry, !p.queue_id);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={t('tokens.bookTitle', { time: `${token.start}–${token.end}`, doctor: doctor.name })} onClose={onClose}>
      {newPatient ? (
        <NewPatientForm token={token} initial={initial} onBack={() => setNewPatient(false)}
          onBookExisting={(p) => book(p)}
          onRegistered={async (p) => {
            toast(t('patients.registered', { code: p.patient_code }));
            await book({ id: p.id });
          }} />
      ) : (
      <>
      <div className="toolbar book-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('queue.searchHint')} autoFocus />
        {canRegister && (
          <Button type="button" variant="ghost" onClick={() => setNewPatient(true)}><Icon name="userPlus" size={16} /> {t('tokens.newPatient')}</Button>
        )}
      </div>
      <ErrorBox error={results.error} />
      {!dq.trim() ? <Empty>{t('queue.typeToSearch')}</Empty> : results.loading && !results.data ? <Loading /> : !results.data?.rows.length ? (
        <Empty>
          {t('queue.noMatch')}{' '}
          {canRegister && <Button size="sm" onClick={() => setNewPatient(true)}>{t('tokens.registerAndBook', { time: token.start })}</Button>}
        </Empty>
      ) : (
        <ul className="result-list">
          {results.data.rows.map((p) => {
            const inQueue = !!p.queue_id;
            const canMove = inQueue && p.queue_status === 'waiting';
            return (
              <li key={p.id}>
                <div className="result-main">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.patient_code} · {p.mobile} · {genderLabel(p.gender, t)} / {ageLabel(p)}</span>
                  <span className="muted small">
                    {inQueue ? t('tokens.alreadyInQueue', { n: p.token_no }) : p.last_visit ? `${t('patients.lastVisit')} ${fmtDate(p.last_visit)}` : t('queue.firstVisit')}
                  </span>
                </div>
                {(!inQueue || canMove) ? (
                  <Button size="sm" onClick={() => book(p)} loading={busy === p.id}>{inQueue ? t('tokens.giveSlot') : t('tokens.book')}</Button>
                ) : <StatusBadge status={p.queue_status} />}
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}
    </Modal>
  );
}

function TokenTile({ token, past, canBook, onBook, onFree, onVitals }) {
  const { t } = useT();
  const e = token.entry;
  if (!e) {
    return (
      <button type="button" className={`token-tile free ${past ? 'past' : ''}`} disabled={!canBook} onClick={onBook}
        title={canBook ? t('tokens.clickToBook') : undefined}>
        <span className="tt-head"><b>#{token.no}</b><span>{token.start}</span></span>
        <span className="tt-body muted">{past ? t('tokens.passed') : t('tokens.available')}</span>
      </button>
    );
  }
  return (
    <div className={`token-tile booked st-${e.status}`}>
      <span className="tt-head"><b>#{token.no}</b><span>{token.start}</span></span>
      <span className="tt-body"><strong>{e.patient_name}</strong><small className="muted">{e.patient_code} · {t('queue.token')} {e.token_no}</small></span>
      <span className="tt-foot">
        <StatusBadge status={e.status} />
        {onVitals && <button type="button" className="icon-btn" title={t('vitals.title')} aria-label={t('vitals.title')} onClick={onVitals}><Icon name="stethoscope" size={15} /></button>}
        {onFree && e.status === 'waiting' && <button type="button" className="icon-btn" title={t('tokens.free')} aria-label={t('tokens.free')} onClick={onFree}><Icon name="trash" size={15} /></button>}
      </span>
    </div>
  );
}

export default function Tokens() {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [doctorId, setDoctorId] = useState('');
  const [booking, setBooking] = useState(null);       // { doctor, token }
  const [vitalsFor, setVitalsFor] = useState(null);
  const data = useAsync(() => api('/queue/tokens', { query: { doctor_id: doctorId } }), [doctorId]);
  const allDoctors = useAsync(() => api('/queue/doctors'), []);
  const canBook = auth.can('queue.confirm');
  const now = nowMinutes();

  async function free(entry) {
    if (!window.confirm(t('tokens.freeConfirm', { time: entry.slot_time, name: entry.patient_name }))) return;
    try {
      await api(`/queue/${entry.id}/slot`, { method: 'PATCH', body: { slot_time: null } });
      data.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title={t('menu.tokens')}
        subtitle={`${auth.activeClinic?.name || ''} · ${t('tokens.today')} ${fmtDate(data.data?.date)}`}
        actions={(
          <>
            {allDoctors.data?.rows?.length > 1 && (
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label={t('menu.doctor')}>
                <option value="">{t('tokens.allDoctors')}</option>
                {allDoctors.data.rows.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <Button variant="ghost" onClick={data.reload}>{t('common.refresh')}</Button>
          </>
        )}
      />
      {data.loading && !data.data ? <Loading /> : <ErrorBox error={data.error} onRetry={data.reload} />}
      {data.data && !data.data.doctors.length && <Card><Empty>{t('tokens.noDoctors')}</Empty></Card>}
      {data.data?.doctors.map((d) => {
        const booked = d.tokens.filter((x) => x.entry).length;
        return (
          <Card key={d.id}
            title={<>{d.name} {d.designation && <span className="muted small">{d.designation}</span>}</>}
            actions={d.tokens.length > 0 && <Badge tone={booked === d.tokens.length ? 'warning' : 'success'}>{t('tokens.bookedOf', { n: booked, total: d.tokens.length })}</Badge>}>
            {!d.tokens.length ? (
              <Empty>
                {t('tokens.noSlots')}{' '}
                {auth.can('employee.edit') && <Button size="sm" variant="ghost" onClick={() => navigate(`/employees/${d.id}/edit`)}>{t('tokens.setSlots')}</Button>}
              </Empty>
            ) : d.sessions.map((s, i) => (
              <div key={i} className="token-session">
                <div className="muted small token-session-head">
                  {s.start_time}–{s.end_time} · {t('tokens.minutesEach', { n: s.slot_minutes })}
                  {s.break_start && ` · ${t('tokens.break')} ${s.break_start}–${s.break_end}`}
                </div>
                <div className="token-grid">
                  {d.tokens.filter((x) => x.session === i).map((x) => (
                    <TokenTile key={x.no} token={x} past={toMinutes(x.end) <= now} canBook={canBook}
                      onBook={() => setBooking({ doctor: d, token: x })}
                      onFree={canBook ? () => free(x.entry) : null}
                      onVitals={auth.can('vitals.record') && x.entry ? () => setVitalsFor(x.entry) : null} />
                  ))}
                </div>
              </div>
            ))}
            {d.unslotted.length > 0 && (
              <p className="muted small">{t('tokens.unslotted', { n: d.unslotted.length })}: {d.unslotted.map((e) => `#${e.token_no} ${e.patient_name}`).join(', ')}</p>
            )}
          </Card>
        );
      })}

      {booking && (
        <BookDialog doctor={booking.doctor} token={booking.token} onClose={() => setBooking(null)}
          onBooked={(entry, isNew) => {
            setBooking(null);
            data.reload();
            if (isNew && auth.can('vitals.record')) setVitalsFor(entry);   // next step, same as Confirm
          }} />
      )}
      {vitalsFor && <VitalsModal entry={vitalsFor} onClose={() => setVitalsFor(null)} onSaved={data.reload} />}
    </>
  );
}
