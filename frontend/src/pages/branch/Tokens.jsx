// Patient & Queue → Tokens: today's tokens per doctor, made from their time slots (Employee → Time slots).
// Click an available token to book a patient into the queue for that doctor and time.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { toMinutes } from '../../../../shared/timeSlots.js';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, SearchBox, StatusBadge, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsModal } from '../../components/VitalSigns.jsx';

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Search a patient and book them into one token (or give a waiting patient this slot). */
function BookDialog({ doctor, token, onClose, onBooked }) {
  const { t } = useT();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [busy, setBusy] = useState(null);
  const results = useAsync(() => (dq.trim() ? api('/queue/search', { query: { q: dq.trim() } }) : Promise.resolve({ rows: [] })), [dq]);

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
      <SearchBox value={q} onChange={setQ} placeholder={t('queue.searchHint')} autoFocus />
      <ErrorBox error={results.error} />
      {!dq.trim() ? <Empty>{t('queue.typeToSearch')}</Empty> : results.loading && !results.data ? <Loading /> : !results.data?.rows.length ? (
        <Empty>{t('queue.noMatch')}</Empty>
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
