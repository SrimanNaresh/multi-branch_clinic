// Pharmacy → Item List
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, SearchBox, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function ItemList() {
  const { t } = useT();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/items', { query: { q: dq, category, page, limit: 50 } }), [dq, category, page]);
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
