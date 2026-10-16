import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, num, todayLocal } from '../../lib/format.js';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, StatusBadge, useAsync } from '../../components/ui.jsx';

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function QueueBar({ c }) {
  const total = c.queue_total || 0;
  const pct = (n) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="queue-bar" title={`${c.queue_waiting} / ${c.queue_with_doctor} / ${c.queue_done}`}>
      <span className="qb-done" style={{ width: pct(c.queue_done) }} />
      <span className="qb-doctor" style={{ width: pct(c.queue_with_doctor) }} />
      <span className="qb-waiting" style={{ width: pct(c.queue_waiting) }} />
    </div>
  );
}

export default function Dashboard() {
  const { t } = useT();
  const auth = useAuth();
  const [date, setDate] = useState(todayLocal());
  const { data, error, loading, reload } = useAsync(() => api('/dashboard/summary', { query: { date }, clinic: null }), [date]);

  const openClinic = (c, path) => {
    auth.setActiveClinic(c.id);
    navigate(path);
  };

  return (
    <>
      <PageHeader
        title={t('menu.dashboard')}
        subtitle={t('dashboard.subtitle')}
        actions={(
          <>
            <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} aria-label={t('field.date')} />
            <Button variant="ghost" onClick={reload}>{t('common.refresh')}</Button>
          </>
        )}
      />
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <>
          <div className="stats">
            <Stat label={t('dashboard.clinics')} value={`${data.totals.clinics_active}/${data.totals.clinics_total}`} sub={t('dashboard.activeTotal')} />
            <Stat label={t('dashboard.patients')} value={num(data.totals.patients_total)} sub={t('dashboard.newToday', { n: data.totals.patients_new_today })} />
            <Stat label={t('dashboard.todayQueue')} value={num(data.totals.queue_total)}
              sub={`${t('status.waiting')} ${data.totals.queue_waiting} · ${t('status.done')} ${data.totals.queue_done}`} tone="info" />
            <Stat label={t('dashboard.billingToday')} value={money(data.totals.billing_today)} sub={t('dashboard.billsCount', { n: data.totals.bills_today })} tone="success" />
            <Stat label={t('dashboard.billingMonth')} value={money(data.totals.billing_month)} />
          </div>

          <Card title={t('dashboard.perBranch')}>
            <div className="branch-grid">
              {data.clinics.map((c) => (
                <article key={c.id} className={`branch-card ${c.status !== 'active' ? 'is-inactive' : ''}`}>
                  <header>
                    <div>
                      <h3>{c.name}</h3>
                      <span className="muted">{c.code}{c.city ? ` · ${c.city}` : ''}</span>
                    </div>
                    <StatusBadge status={c.status} />
                  </header>
                  <dl className="kv">
                    <div><dt>{t('dashboard.patients')}</dt><dd>{num(c.patients_total)} <small className="muted">+{c.patients_new_today}</small></dd></div>
                    <div><dt>{t('dashboard.todayQueue')}</dt><dd>{c.queue_total}</dd></div>
                    <div><dt>{t('dashboard.billingToday')}</dt><dd>{money(c.billing_today)}</dd></div>
                    <div><dt>{t('dashboard.billingMonth')}</dt><dd>{money(c.billing_month)}</dd></div>
                  </dl>
                  <QueueBar c={c} />
                  <div className="queue-legend">
                    <span><i className="dot dot-waiting" />{t('status.waiting')} {c.queue_waiting}</span>
                    <span><i className="dot dot-doctor" />{t('status.with_doctor')} {c.queue_with_doctor}</span>
                    <span><i className="dot dot-done" />{t('status.done')} {c.queue_done}</span>
                  </div>
                  <footer>
                    <span className="muted">{t('dashboard.staff', { n: c.employees })} · {t('dashboard.unitsShort', { p: c.pharmacies, l: c.labs })}</span>
                    {c.low_stock_items > 0 && <Badge tone="danger">{t('dashboard.lowStock', { n: c.low_stock_items })}</Badge>}
                  </footer>
                  {c.status === 'active' && (
                    <div className="branch-actions">
                      <Button size="sm" variant="ghost" onClick={() => openClinic(c, '/queue')}>{t('menu.confirmList')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => openClinic(c, '/bills')}>{t('menu.billList')}</Button>
                    </div>
                  )}
                </article>
              ))}
              {!data.clinics.length && (
                <div className="empty">
                  {t('dashboard.noClinics')} <Button size="sm" onClick={() => navigate('/clinics')}>{t('clinics.add')}</Button>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
