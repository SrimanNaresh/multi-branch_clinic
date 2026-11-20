// Pharmacy → Stock In → Adjustment List: every stock adjustment, newest first (an Admin may delete one)
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

export default function StockAdjustmentList() {
  const { t } = useT();
  const { isGlobal: isAdmin } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/stock-adjustments', { query: { q: dq, page, limit: 50 } }), [dq, page]);

  async function remove(r) {
    if (!window.confirm(t('pharma.deleteConfirm', { no: r.adj_no }))) return;
    try {
      await api(`/stock-adjustments/${r.id}`, { method: 'DELETE' });
      toast(t('pharma.deleted', { no: r.adj_no }));
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'adj_no', label: t('adj.no'), render: (r) => <b>{r.adj_no}</b> },
    { key: 'adj_date', label: t('purchase.date'), render: (r) => fmtDate(r.adj_date) },
    { key: 'item_names', label: t('items.name'), render: (r) => <b>{r.item_names}</b> },
    { key: 'remarks', label: t('adj.remarks'), render: (r) => r.remarks || '—' },
    { key: 'in_qty', label: t('adj.inQty'), className: 'num', render: (r) => Number(r.in_qty || 0) },
    { key: 'in_total', label: t('adj.inTotal'), className: 'num', render: (r) => money(r.in_total) },
    { key: 'out_qty', label: t('adj.outQty'), className: 'num', render: (r) => Number(r.out_qty || 0) },
    { key: 'out_total', label: t('adj.outTotal'), className: 'num', render: (r) => money(r.out_total) },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/stock-adjustments/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
          {isAdmin && <Button size="sm" variant="ghost" className="btn-danger-ghost" onClick={() => remove(r)}><Icon name="trash" size={15} /> {t('common.delete')}</Button>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader compact title={t('menu.adjustment')} subtitle={list.data ? t('adj.count', { n: list.data.total }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/stock-adjustments/new')}><Icon name="plus" size={16} /> {t('adj.new')}</Button>} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('adj.searchHint')} />
          <ExportButtons title={t('menu.adjustment')} columns={[
      { label: t('adj.no'), value: (r) => r.adj_no }, { label: t('purchase.date'), type: 'date', value: (r) => r.adj_date },
      { label: t('items.name'), value: (r) => r.item_names }, { label: t('adj.remarks'), value: (r) => r.remarks },
      { label: t('adj.inQty'), type: 'qty', value: (r) => r.in_qty }, { label: t('adj.inTotal'), type: 'money', value: (r) => r.in_total },
      { label: t('adj.outQty'), type: 'qty', value: (r) => r.out_qty }, { label: t('adj.outTotal'), type: 'money', value: (r) => r.out_total }]}
            getRows={() => fetchAll((p) => api('/stock-adjustments', { query: { ...{ q: dq }, page: p, limit: 100 } }))} />
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
