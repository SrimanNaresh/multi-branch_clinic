// Pharmacy → Purchase / Order → List: every order, newest first
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function PurchaseList() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/purchases', { query: { q: dq, page, limit: 50 } }), [dq, page]);

  const columns = [
    { key: 'po_no', label: t('purchase.no'), render: (r) => <b>{r.po_no}</b> },
    { key: 'po_date', label: t('purchase.date'), render: (r) => fmtDate(r.po_date) },
    { key: 'supplier_name', label: t('purchase.vendor') },
    { key: 'item_count', label: t('purchase.items'), className: 'num' },
    { key: 'total_amount', label: t('purchase.sumTotal'), className: 'num', render: (r) => money(r.total_amount) },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => <Button size="sm" variant="ghost" onClick={() => navigate(`/purchase/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>,
    },
  ];

  return (
    <>
      <PageHeader compact title={t('menu.purchase')} subtitle={list.data ? t('purchase.count', { n: list.data.total }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/purchase/new')}><Icon name="plus" size={16} /> {t('purchase.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('purchase.searchHint')} />
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
