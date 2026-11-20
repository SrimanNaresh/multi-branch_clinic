// Pharmacy → Return → List: every Return to a vendor, newest first
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ExportButtons from '../../components/ExportButtons.jsx';
import { fetchAll } from '../../lib/exportTable.js';

export default function ReturnList() {
  const { t } = useT();
  const { isGlobal: isAdmin } = useAuth();
  const toast = useToast();
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
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/returns/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
          {isAdmin && <Button size="sm" variant="ghost" className="btn-danger-ghost" onClick={() => remove(r)}><Icon name="trash" size={15} /> {t('common.delete')}</Button>}
        </span>
      ),
    },
  ];

  async function remove(r) {
    if (!window.confirm(t('pharma.deleteConfirm', { no: r.return_no }))) return;
    try {
      await api(`/returns/${r.id}`, { method: 'DELETE' });
      toast(t('pharma.deleted', { no: r.return_no }));
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader compact title={t('menu.return')} subtitle={list.data ? t('return.count', { n: list.data.total }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/returns/new')}><Icon name="plus" size={16} /> {t('return.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('return.searchHint')} />
          <ExportButtons title={t('menu.purchaseReturn')} columns={[
      { label: t('return.no'), value: (r) => r.return_no }, { label: t('purchase.date'), type: 'date', value: (r) => r.return_date },
      { label: t('purchase.vendor'), value: (r) => r.supplier_name }, { label: t('stockin.no'), value: (r) => r.si_no },
      { label: t('items.name'), value: (r) => r.item_names }, { label: t('stockin.totalQty'), type: 'qty', value: (r) => r.total_qty },
      { label: t('purchase.amount'), type: 'money', value: (r) => r.total_amount }]}
            getRows={() => fetchAll((p) => api('/returns', { query: { ...{ q: dq }, page: p, limit: 100 } }))} />
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
