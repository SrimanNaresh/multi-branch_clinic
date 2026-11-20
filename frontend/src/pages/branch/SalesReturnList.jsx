// Pharmacy → Return → Sales Return List: every return from customers, newest first (an Admin may delete one)
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function SalesReturnList() {
  const { t } = useT();
  const { isGlobal: isAdmin } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/sales-returns', { query: { q: dq, page, limit: 50 } }), [dq, page]);

  async function remove(r) {
    if (!window.confirm(t('pharma.deleteConfirm', { no: r.return_no }))) return;
    try {
      await api(`/sales-returns/${r.id}`, { method: 'DELETE' });
      toast(t('pharma.deleted', { no: r.return_no }));
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'return_no', label: t('sret.no'), render: (r) => <b>{r.return_no}</b> },
    { key: 'return_date', label: t('purchase.date'), render: (r) => fmtDate(r.return_date) },
    { key: 'sale_no', label: t('sale.no'), render: (r) => r.sale_no || '—' },
    { key: 'customer_name', label: t('sale.customer') },
    { key: 'mobile', label: t('suppliers.mobile'), render: (r) => r.mobile || '—' },
    { key: 'item_names', label: t('items.name'), render: (r) => <b>{r.item_names}</b> },
    { key: 'total_qty', label: t('stockin.totalQty'), className: 'num', render: (r) => Number(r.total_qty || 0) },
    { key: 'total_amount', label: t('sret.refund'), className: 'num', render: (r) => <b>{money(r.total_amount)}</b> },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/sales-returns/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
          {isAdmin && <Button size="sm" variant="ghost" className="btn-danger-ghost" onClick={() => remove(r)}><Icon name="trash" size={15} /> {t('common.delete')}</Button>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader compact title={t('menu.salesReturn')}
        subtitle={list.data ? t('sret.count', { n: list.data.total, amount: money(list.data.amount) }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/sales-returns/new')}><Icon name="plus" size={16} /> {t('sret.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('sret.searchHint')} />
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
