// Pharmacy → Return → List: every Return to a vendor, newest first
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function ReturnList() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/returns', { query: { q: dq, page, limit: 50 } }), [dq, page]);

  const columns = [
    { key: 'return_no', label: t('return.no'), render: (r) => <b>{r.return_no}</b> },
    { key: 'return_date', label: t('purchase.date'), render: (r) => fmtDate(r.return_date) },
    { key: 'supplier_name', label: t('purchase.vendor') },
    { key: 'si_no', label: t('stockin.no') },
    { key: 'item_names', label: t('items.name'), render: (r) => <b>{r.item_names}</b> },
    { key: 'item_count', label: t('purchase.items'), className: 'num' },
    { key: 'total_qty', label: t('stockin.totalQty'), className: 'num', render: (r) => Number(r.total_qty || 0) },
    { key: 'total_amount', label: t('purchase.amount'), className: 'num', render: (r) => money(r.total_amount) },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => <Button size="sm" variant="ghost" onClick={() => navigate(`/returns/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>,
    },
  ];

  return (
    <>
      <PageHeader compact title={t('menu.return')} subtitle={list.data ? t('return.count', { n: list.data.total }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/returns/new')}><Icon name="plus" size={16} /> {t('return.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('return.searchHint')} />
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
