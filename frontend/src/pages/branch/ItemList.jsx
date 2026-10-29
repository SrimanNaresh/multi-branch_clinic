// Pharmacy → Item List (+ stock in / adjustment)
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, ErrorBox, Input, Loading, Modal, PageHeader, Pagination, SearchBox, Select, StatusBadge, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

function StockModal({ item, onClose, onDone }) {
  const { t } = useT();
  const toast = useToast();
  const auth = useAuth();
  const [f, setF] = useState({ reason: 'purchase', qty: '', supplier_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const suppliers = useAsync(() => (auth.can('supplier.manage') ? api('/suppliers', { query: { status: 'active' } }) : Promise.resolve({ rows: [] })), []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/items/${item.id}/stock`, { method: 'POST', body: { ...f, supplier_id: f.supplier_id || undefined } });
      toast(t('items.stockUpdated'));
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('items.stockIn')} – ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <Select label={t('items.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}
          options={['purchase', 'return', 'adjustment'].map((r) => ({ value: r, label: t(`items.reason_${r}`) }))} />
        <Input label={t('examine.qty')} type="number" step="0.01" required value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })}
          hint={f.reason === 'adjustment' ? t('items.adjustHint') : t('items.currentStock', { n: `${item.stock_qty} ${item.unit}` })} />
        {f.reason === 'purchase' && suppliers.data?.rows?.length > 0 && (
          <Select label={t('menu.supplier')} value={f.supplier_id} placeholder="—" onChange={(e) => setF({ ...f, supplier_id: e.target.value })}
            options={suppliers.data.rows.map((s) => ({ value: String(s.id), label: s.name }))} />
        )}
        <Input label={t('field.notes')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} full />
        <div className="form-actions field-full">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ItemList() {
  const { t } = useT();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const [stockItem, setStockItem] = useState(null);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/items', { query: { q: dq, category, low_stock: low ? '1' : '', page, limit: 50 } }), [dq, category, low, page]);
  const cats = useAsync(() => api('/items/categories'), []);

  const columns = [
    { key: 'item_code', label: t('items.code'), render: (r) => <span className="muted">{r.item_code}</span> },
    { key: 'name', label: t('items.name'), render: (r) => <b>{r.name}</b> },
    { key: 'category', label: t('items.category') },
    { key: 'unit', label: t('items.unit') },
    { key: 'price', label: t('items.price'), render: (r) => money(r.price), className: 'num' },
    {
      key: 'stock_qty', label: t('items.stock'), className: 'num',
      render: (r) => (Number(r.stock_qty) <= Number(r.reorder_level)
        ? <Badge tone="danger">{r.stock_qty}</Badge>
        : <span>{r.stock_qty}</span>),
    },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
    ...(auth.can('item.manage') ? [{
      key: '_a', label: '', className: 'col-actions',
      render: (r) => (
        <span className="row-actions">
          {auth.can('stock.manage') && <Button size="sm" variant="ghost" onClick={() => setStockItem(r)}><Icon name="plus" size={15} /> {t('items.stockIn')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => navigate(`/items/${r.id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
        </span>
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader title={t('menu.itemList')} subtitle={list.data ? t('items.count', { n: list.data.total }) : ''}
        actions={auth.can('item.manage') && <Button onClick={() => navigate('/items/new')}><Icon name="plus" size={16} /> {t('menu.item')}</Button>} />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('items.searchHint')} />
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t('items.category')}>
            <option value="">{t('items.allCategories')}</option>
            {(cats.data?.rows || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={low} onChange={(e) => { setLow(e.target.checked); setPage(1); }} /> {t('items.lowOnly')}</label>
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {stockItem && <StockModal item={stockItem} onClose={() => setStockItem(null)} onDone={() => { setStockItem(null); list.reload(); }} />}
    </>
  );
}
