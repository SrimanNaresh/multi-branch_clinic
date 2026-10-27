// Confirm List: today's queue with token number and status (waiting / with doctor / done)
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, fmtTime12, genderLabel, queueStatus, todayLocal } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, StatusBadge, useAsync, useToast } from '../../components/ui.jsx';
import Icon, { CancelIcon, ConfirmIcon, DoctorIcon, VitalsIcon } from '../../components/Icon.jsx';
import { VitalsModal, vitalsSummary } from '../../components/VitalSigns.jsx';

const TABS = ['all', 'booked', 'confirmed', 'waiting', 'with_doctor', 'done', 'cancelled'];

export default function ConfirmList() {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayLocal());
  const [tab, setTab] = useState('all');
  const [vitalsFor, setVitalsFor] = useState(null);
  const list = useAsync(() => api('/queue', { query: { date } }), [date]);
  const isToday = date === todayLocal();

  // Auto-refresh today's queue every 30 seconds
  useEffect(() => {
    if (!isToday) return undefined;
    const h = setInterval(list.reload, 30000);
    return () => clearInterval(h);
  }, [isToday, list.reload]);

  async function move(row, status) {
    try {
      await api(`/queue/${row.id}/status`, { method: 'PATCH', body: { status } });
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Token confirm: a patient booked from Tokens has arrived – this unlocks vital signs
  async function confirmToken(row) {
    try {
      await api(`/queue/${row.id}/arrive`, { method: 'PATCH' });
      toast(t('queue.tokenConfirmed', { name: row.patient_name }));
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // tabs and counts use the shown status, so "Token booked" patients are kept apart from Pre-Examine
  const rows = (list.data?.rows || []).filter((r) => tab === 'all' || queueStatus(r) === tab);
  const counts = {};
  for (const r of list.data?.rows || []) counts[queueStatus(r)] = (counts[queueStatus(r)] || 0) + 1;
  const total = (list.data?.rows || []).filter((r) => r.status !== 'cancelled').length;

  // Row actions only for today's queue. Confirm token sits in the Vital signs column, since it unlocks the vitals;
  // examining happens from Doctor → Examine, not from this list.
  const canMove = isToday && auth.can('queue.update');
  // once vital signs are saved the token is confirmed and can no longer be cancelled
  const canCancel = (r) => canMove && r.status === 'waiting' && !r.vitals_id;
  const canRequeue = (r) => canMove && r.status === 'cancelled';
  // the Cancel column (header and cells) only shows while a listed row can be cancelled or re-queued
  const showCancelCol = rows.some((r) => canCancel(r) || canRequeue(r));

  const doctorCell = (r) => {
    // Send to doctor only appears once vital signs are saved (a Tokens booking must be confirmed before vitals can be saved)
    if (canMove && r.status === 'waiting' && r.vitals_id) {
      return (
        <button type="button" className="icon-btn img-btn" title={t('queue.sendToDoctor')} aria-label={t('queue.sendToDoctor')}
          onClick={() => move(r, 'with_doctor')}>
          <DoctorIcon />
        </button>
      );
    }
    if (canMove && r.status === 'with_doctor' && !r.visit_id) {
      return <Button size="sm" variant="ghost" onClick={() => move(r, 'waiting')}>{t('queue.backToWaiting')}</Button>;
    }
    return null;
  };

  const cancelCell = (r) => {
    if (canCancel(r)) {
      return (
        <button type="button" className="icon-btn img-btn" title={t('queue.cancelToken')} aria-label={t('queue.cancelToken')}
          onClick={() => move(r, 'cancelled')}>
          <CancelIcon />
        </button>
      );
    }
    if (canRequeue(r)) return <Button size="sm" variant="ghost" onClick={() => move(r, 'waiting')}>{t('queue.requeue')}</Button>;
    return null;
  };

  const columns = [
    { key: 'token_no', label: t('queue.token'), render: (r) => <span className="token-chip">#{r.token_no}</span> },
    { key: 'patient_name', label: t('field.name'), render: (r) => (
      <>
        <b>{r.patient_name}</b>
        {/* code and booking tag share one line, so every row has the same height */}
        <span className="name-sub">
          <span className="muted small">{r.patient_code}</span>
          {/* only the Tokens page books a time slot, so slot_time marks a token booking */}
          {r.slot_time && (
            <span className={`slot-tag ${r.arrived_at ? 'arrived' : ''}`}>
              <Icon name={r.arrived_at ? 'check' : 'clock'} size={12} /> {t(r.arrived_at ? 'queue.tokenBookingConfirmed' : 'queue.tokenBooking', { time: fmtTime12(r.slot_time) })}
            </span>
          )}
        </span>
      </>
    ) },
    // col-wide-only: hidden on mid-size screens (sidebar + table), shown on wide screens and in phone/tablet cards
    { key: 'ga', label: t('field.genderAge'), className: 'col-wide-only', render: (r) => `${genderLabel(r.gender, t)} / ${ageLabel(r)}` },
    { key: 'visit_type', label: t('queue.visitType'), className: 'col-wide-only', render: (r) => t(`queue.${r.visit_type}`) },
    { key: 'confirmed_at', label: t('queue.time'), render: (r) => fmtDate(r.confirmed_at, true).split(', ')[1] },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={queueStatus(r)} /> },
    { key: 'vitals', label: t('vitals.title'), render: (r) => {
      const canEdit = auth.can('vitals.record') && r.status !== 'cancelled';
      const locked = !r.arrived_at;   // Tokens booking not confirmed yet
      const recorded = !!r.vitals_id;
      const confirmBtn = isToday && locked && r.status !== 'cancelled' && auth.can('queue.confirm') && (
        <button type="button" className="icon-btn img-btn" title={t('queue.confirmTokenTitle')} aria-label={t('queue.confirmTokenTitle')}
          onClick={() => confirmToken(r)}>
          <ConfirmIcon />
        </button>
      );
      // recorded vitals can always be opened (read-only without the right / before confirming); new ones need both
      const title = recorded
        ? `${t('vitals.viewTitle')}: ${vitalsSummary(r, t) || t('vitals.commentsOnly')}`
        : locked ? t('queue.confirmTokenFirst') : t('vitals.addTitle');
      const vitalsBtn = (recorded || canEdit) && (
        <button type="button" className={`icon-btn vitals-add ${recorded ? 'recorded' : ''}`} disabled={!recorded && locked}
          title={title} aria-label={recorded ? t('vitals.viewTitle') : t('vitals.addTitle')}
          onClick={() => setVitalsFor({ ...r, readOnly: !canEdit || locked })}>
          <VitalsIcon />
          {recorded
            ? <span className="vitals-badge done"><Icon name="check" size={11} /></span>
            : locked && <span className="vitals-badge"><Icon name="lock" size={11} /></span>}
        </button>
      );
      if (!confirmBtn && !vitalsBtn) return '—';
      return <span className="row-actions vitals-cell">{confirmBtn}{vitalsBtn}</span>;
    } },
    isToday && { key: '_doctor', label: t('queue.colDoctor'), className: 'col-icon', render: doctorCell },
    showCancelCol && { key: '_cancel', label: t('queue.colCancel'), className: 'col-icon', render: cancelCell },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={t('menu.confirmList')}
        subtitle={`${auth.activeClinic?.name} · ${t('queue.totalToday', { n: total })}`}
        actions={(
          <>
            <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} aria-label={t('field.date')} />
            {auth.can('queue.confirm') && <Button onClick={() => navigate('/queue/confirm')}><Icon name="plus" size={16} /> {t('menu.confirmSearch')}</Button>}
          </>
        )}
      />
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k === 'all' ? t('common.all') : t(`status.${k}`)}
            <span className="tab-count">{k === 'all' ? (list.data?.rows.length || 0) : counts[k] || 0}</span>
          </button>
        ))}
      </div>
      <Card>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <div className="queue-list">
            <DataTable columns={columns} rows={rows} empty={t('queue.empty')} rowClassName={(r) => (r.slot_time ? 'row-slot' : '')} />
          </div>
        )}
        {rows.some((r) => r.slot_time) && (
          <p className="muted small slot-legend"><span className="slot-swatch" /> {t('queue.tokenBookingLegend')}</p>
        )}
      </Card>
      {vitalsFor && <VitalsModal entry={vitalsFor} readOnly={vitalsFor.readOnly} onClose={() => setVitalsFor(null)} onSaved={list.reload} />}
    </>
  );
}
