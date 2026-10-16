import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function BillList() {
  const { t } = useT();
  const auth = useAuth();
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/bills', { query: { from, to, q: dq, page } }), [from, to, dq, page]);

  const columns = [
    { key: 'bill_no', label: t('billing.billNo'), render: (r) => <b>{r.bill_no}</b> },
    { key: 'bill_date', label: t('field.date'), render: (r) => fmtDate(r.bill_date, true) },
    { key: 'patient_name', label: t('field.name'), render: (r) => <>{r.patient_name}<br /><span className="muted small">{r.patient_code}</span></> },
    { key: 'net_amount', label: t('billing.net'), render: (r) => money(r.net_amount), className: 'num' },
    { key: 'paid_amount', label: t('billing.paid'), render: (r) => money(r.paid_amount), className: 'num' },
    { key: 'payment_mode', label: t('billing.mode'), render: (r) => t(`billing.mode_${r.payment_mode}`) },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader title={t('menu.billList')} subtitle={auth.activeClinic?.name}
        actions={auth.can('bill.create') && <Button onClick={() => navigate('/billing')}><Icon name="receipt" size={16} /> {t('menu.patientBill')}</Button>} />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('billing.searchHint')} />
          <label className="inline-field">{t('billing.from')} <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="inline-field">{t('billing.to')} <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        {list.data && (
          <div className="summary-row">
            <span>{t('billing.billsCount', { n: list.data.total })}</span>
            <span>{t('billing.net')}: <b>{money(list.data.net_total)}</b></span>
            <span>{t('billing.collected')}: <b>{money(list.data.paid_total)}</b></span>
          </div>
        )}
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} onRowClick={(r) => navigate(`/bills/${r.id}`)} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
