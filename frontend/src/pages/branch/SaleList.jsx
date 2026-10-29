// Pharmacy → Sales → List: every counter sale, newest first, with its items and the total of all matching sales
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function SaleList() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/sales', { query: { q: dq, page, limit: 50 } }), [dq, page]);

  const columns = [
    { key: 'sale_no', label: t('sale.no'), render: (r) => <b>{r.sale_no}</b> },
    { key: 'sale_date', label: t('purchase.date'), render: (r) => fmtDate(r.sale_date) },
    { key: 'customer_name', label: t('sale.customer') },
    { key: 'mobile', label: t('suppliers.mobile'), render: (r) => r.mobile || '—' },
    { key: 'item_names', label: t('items.name'), render: (r) => <b>{r.item_names}</b> },
    { key: 'total_qty', label: t('stockin.totalQty'), className: 'num', render: (r) => Number(r.total_qty || 0) },
    { key: 'total_amount', label: t('purchase.amount'), className: 'num', render: (r) => <b>{money(r.total_amount)}</b> },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>,
    },
  ];

  return (
    <>
      <PageHeader compact title={t('menu.sales')}
        subtitle={list.data ? t('sale.count', { n: list.data.total, amount: money(list.data.amount) }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/sales/new')}><Icon name="plus" size={16} /> {t('sale.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('sale.searchHint')} />
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
