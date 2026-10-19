// Confirm List: today's queue with token number and status (waiting / with doctor / done)
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, fmtTime12, genderLabel, queueStatus, todayLocal } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, StatusBadge, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { VitalsModal, vitalsSummary } from '../../components/VitalSigns.jsx';

const TABS = ['all', 'booked', 'waiting', 'with_doctor', 'done', 'cancelled'];

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

  const actions = (r) => {
    if (!isToday) return null;
    const btn = [];
    if (!r.arrived_at && r.status !== 'cancelled' && auth.can('queue.confirm')) {
      btn.push(<Button key="arrive" size="sm" onClick={() => confirmToken(r)}><Icon name="check" size={15} /> {t('queue.tokenConfirm')}</Button>);
    }
    // Examining happens from Doctor → Examine, not from this list
    if (r.status === 'waiting' && auth.can('queue.update')) {
      btn.push(<Button key="call" size="sm" onClick={() => move(r, 'with_doctor')}>{t('queue.sendToDoctor')}</Button>);
    }
    if (r.status === 'with_doctor' && auth.can('queue.update') && !r.visit_id) {
      btn.push(<Button key="back" size="sm" variant="ghost" onClick={() => move(r, 'waiting')}>{t('queue.backToWaiting')}</Button>);
    }
    if (r.status === 'waiting' && auth.can('queue.update')) {
      btn.push(<Button key="cancel" size="sm" variant="ghost" onClick={() => move(r, 'cancelled')}>{t('common.cancel')}</Button>);
    }
    if (r.status === 'cancelled' && auth.can('queue.update')) {
      btn.push(<Button key="re" size="sm" variant="ghost" onClick={() => move(r, 'waiting')}>{t('queue.requeue')}</Button>);
    }
    return <span className="row-actions">{btn}</span>;
  };

  const columns = [
    { key: 'token_no', label: t('queue.token'), render: (r) => <span className="token-chip">#{r.token_no}</span> },
    { key: 'patient_name', label: t('field.name'), render: (r) => (
      <>
        <b>{r.patient_name}</b><br /><span className="muted small">{r.patient_code}</span>
        {/* only the Tokens page books a time slot, so slot_time marks a token booking */}
        {r.slot_time && (
          <><br /><span className={`slot-tag ${r.arrived_at ? 'arrived' : ''}`}>
            <Icon name={r.arrived_at ? 'check' : 'clock'} size={12} /> {t(r.arrived_at ? 'queue.tokenBookingConfirmed' : 'queue.tokenBooking', { time: fmtTime12(r.slot_time) })}
          </span></>
        )}
      </>
    ) },
    // col-wide-only: hidden on mid-size screens (sidebar + table), shown on wide screens and in phone/tablet cards
    { key: 'ga', label: t('field.genderAge'), className: 'col-wide-only', render: (r) => `${genderLabel(r.gender, t)} / ${ageLabel(r)}` },
    { key: 'visit_type', label: t('queue.visitType'), className: 'col-wide-only', render: (r) => t(`queue.${r.visit_type}`) },
    { key: 'vitals', label: t('vitals.title'), render: (r) => {
      const canEdit = auth.can('vitals.record') && r.status !== 'cancelled';
      const locked = !r.arrived_at;   // Tokens booking not confirmed yet
      const lockTitle = locked ? t('queue.confirmTokenFirst') : undefined;
      if (r.vitals_id) {
        return (
          <span className="vitals-cell">
            <span className="small">{vitalsSummary(r, t) || t('vitals.commentsOnly')}</span>
            {canEdit && <button type="button" className="icon-btn" title={lockTitle || t('vitals.edit')} aria-label={t('vitals.edit')} disabled={locked} onClick={() => setVitalsFor(r)}><Icon name="edit" size={15} /></button>}
          </span>
        );
      }
      return canEdit ? <Button size="sm" variant="ghost" disabled={locked} title={lockTitle} onClick={() => setVitalsFor(r)}><Icon name={locked ? 'lock' : 'plus'} size={14} /> {t('vitals.add')}</Button> : '—';
    } },
    { key: 'confirmed_at', label: t('queue.time'), render: (r) => fmtDate(r.confirmed_at, true).split(', ')[1] },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={queueStatus(r)} /> },
    { key: '_a', label: '', className: 'col-actions', render: actions },
  ];

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
        {list.data && <DataTable columns={columns} rows={rows} empty={t('queue.empty')} rowClassName={(r) => (r.slot_time ? 'row-slot' : '')} />}
        {rows.some((r) => r.slot_time) && (
          <p className="muted small slot-legend"><span className="slot-swatch" /> {t('queue.tokenBookingLegend')}</p>
        )}
      </Card>
      {vitalsFor && <VitalsModal entry={vitalsFor} onClose={() => setVitalsFor(null)} onSaved={list.reload} />}
    </>
  );
}
