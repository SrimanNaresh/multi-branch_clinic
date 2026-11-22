// Pharmacy → Dashboard: today's and this month's sales and purchases, stock alerts (low, out, expiring,
// expired), what is owed to vendors, the last 7 days of sales and the latest bills. Each card opens its screen.
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, num } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, useAsync } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

const qtyText = (n) => String(Math.round(Number(n || 0) * 100) / 100);
const month = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—');

function Stat({ label, value, sub, tone, to }) {
  const go = to ? () => navigate(to) : undefined;
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}${to ? ' stat-link' : ''}`} onClick={go} role={to ? 'link' : undefined}
      tabIndex={to ? 0 : undefined} onKeyDown={to ? (e) => { if (e.key === 'Enter') go(); } : undefined}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// Quick Actions: the everyday entry screens, each shown only to users who may open it
const QUICK = [
  { to: '/sales/new', label: 'pdash.qaSale', icon: 'receipt', perm: 'dispense' },
  { to: '/stock-in/ips', label: 'menu.threeInOne', icon: 'scan', perm: 'stock.manage' },
  { to: '/purchase/new', label: 'pdash.qaOrder', icon: 'truck', perm: 'stock.manage' },
  { to: '/stock-in/new', label: 'pdash.qaStockIn', icon: 'box', perm: 'stock.manage' },
  { to: '/items/new', label: 'pdash.qaItem', icon: 'plus', perm: 'item.manage' },
  { to: '/sales-returns/new', label: 'menu.salesReturn', icon: 'history', perm: 'sales.return' },
  { to: '/vendor-payments', label: 'pdash.qaPay', icon: 'receipt', perm: 'vendor.pay' },
  { to: '/stock-adjustments/new', label: 'menu.adjustmentEntry', icon: 'edit', perm: 'stock.adjust' },
  { to: '/reports/stock', label: 'menu.stockReport', icon: 'list', perm: 'item.view' },
];

export default function PharmacyDashboard() {
  const { t } = useT();
  const auth = useAuth();
  const { data, error, loading, reload } = useAsync(() => api('/pharmacy-dashboard'), []);
  const maxDay = data ? Math.max(1, ...data.week.map((d) => d.amount)) : 1;

  return (
    <>
      <PageHeader compact title={t('pdash.title')} subtitle={data ? fmtDate(data.today) : ''}
        actions={<Button size="sm" variant="ghost" onClick={reload}>{t('common.refresh')}</Button>} />
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <>
          <div className="stats">
            <Stat tone="success" label={t('pdash.salesToday')} value={money(data.sales.today_amount - data.sales.today_returns)}
              sub={t('pdash.billsReturns', { n: data.sales.today_count, r: money(data.sales.today_returns) })} to={auth.can('dispense') ? '/sales' : undefined} />
            <Stat label={t('pdash.salesMonth')} value={money(data.sales.month_amount - data.sales.month_returns)}
              sub={t('pdash.billsReturns', { n: data.sales.month_count, r: money(data.sales.month_returns) })} />
            <Stat tone="info" label={t('pdash.purchaseToday')} value={money(data.purchases.today_amount)}
              sub={t('pdash.purchaseMonth', { n: data.purchases.today_count, m: money(data.purchases.month_amount) })} to={auth.can('stock.manage') ? '/stock-in' : undefined} />
            <Stat label={t('pdash.vendorDues')} value={money(data.vendor_dues)} sub={t('pdash.vendorDuesSub')}
              to={auth.can('vendor.pay') ? '/vendor-payments' : undefined} />
            <Stat label={t('pdash.stockValue')} value={money(data.stock.stock_value)} sub={t('pdash.items', { n: num(data.stock.item_count) })}
              to="/reports/stock" />
            <Stat tone={data.stock.low_count ? 'warn' : undefined} label={t('pdash.low')} value={num(data.stock.low_count)}
              sub={t('pdash.out', { n: num(data.stock.out_count) })} to="/reports/stock" />
            <Stat tone={data.expiring.count ? 'warn' : undefined} label={t('pdash.expiring')} value={num(data.expiring.count)} sub={t('pdash.expiringSub')} />
            <Stat tone={data.expired.count ? 'danger' : undefined} label={t('pdash.expired')} value={num(data.expired.count)} sub={t('pdash.expiredSub')}
              to={auth.can('stock.adjust') ? '/stock-adjustments/new' : undefined} />
          </div>

          {QUICK.some((a) => auth.can(a.perm)) && (
            <Card title={t('pdash.quick')} className="pdash-quick">
              <div className="pdash-actions">
                {QUICK.filter((a) => auth.can(a.perm)).map((a) => (
                  <button key={a.to} type="button" className="pdash-action" onClick={() => navigate(a.to)}>
                    <Icon name={a.icon} size={16} /> <span>{t(a.label)}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="pdash-grid">
            <Card title={t('pdash.week')}>
              <div className="pdash-bars">
                {data.week.map((d) => (
                  <div key={d.date} className="pdash-bar" title={`${fmtDate(d.date)} · ${d.bills} · ${money(d.amount)}`}>
                    <span className="pdash-bar-amt">{d.amount ? money(d.amount) : ''}</span>
                    <span className="pdash-bar-fill" style={{ height: `${Math.max(2, (d.amount / maxDay) * 100)}%` }} />
                    <span className="pdash-bar-day">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title={t('pdash.recent')}>
              {data.recent.length ? (
                <table className="table">
                  <tbody>
                    {data.recent.map((s) => (
                      <tr key={s.id} className="vp-doc" onClick={() => auth.can('dispense') && navigate(`/sales/${s.id}/edit`)}>
                        <td><b>{s.sale_no}</b></td>
                        <td className="muted">{fmtDate(s.sale_date)}</td>
                        <td>{s.customer_name}</td>
                        <td className="num"><b>{money(s.total_amount)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>{t('pdash.noSales')}</Empty>}
            </Card>

            <Card title={t('pdash.lowList')}>
              {data.low_items.length ? (
                <table className="table">
                  <thead><tr><th>{t('items.name')}</th><th className="num">{t('sale.stock')}</th><th className="num">{t('pdash.reorder')}</th></tr></thead>
                  <tbody>
                    {data.low_items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td className="num"><b className={Number(i.stock_qty) <= 0 ? 'sr-out' : undefined}>{qtyText(i.stock_qty)}</b></td>
                        <td className="num">{qtyText(i.reorder_level)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>{t('pdash.noLow')}</Empty>}
            </Card>

            <Card title={t('pdash.expiryList')}>
              {data.expired.rows.length + data.expiring.rows.length ? (
                <table className="table">
                  <thead><tr><th>{t('items.name')}</th><th>{t('stockin.batch')}</th><th>{t('stockin.exp')}</th><th className="num">{t('sale.stock')}</th></tr></thead>
                  <tbody>
                    {[...data.expired.rows, ...data.expiring.rows].map((b) => {
                      const gone = String(b.exp_date).slice(0, 10) < data.today;
                      return (
                        <tr key={b.id}>
                          <td>{b.item_name}</td>
                          <td>{b.batch_no || '—'}</td>
                          <td><span className={`sr-kind ${gone ? 'sr-kind-returned' : 'sr-kind-adjusted'}`}>{month(b.exp_date)}</span></td>
                          <td className="num">{qtyText(b.left_qty)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <Empty>{t('pdash.noExpiry')}</Empty>}
            </Card>
          </div>
          <p className="muted"><Icon name="file" size={13} /> {t('pdash.note')}</p>
        </>
      )}
    </>
  );
}
