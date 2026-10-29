// Pharmacy → Report → Stock Report: item-wise stock, from each item's stock history –
// Opening + Stock In − Return − Sold + Adjustment = Current Stock, and its value at the selling price.
// Clicking an item opens its stock history (each change, newest first) under its row.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Card, Empty, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

const SHOW = ['moved', 'instock', 'out', 'all'];
/** Which report column a stock change belongs to (same rules as the server's totals) */
const kindOf = (m) => {
  if (m.ref_type === 'stock_in' || (m.reason === 'purchase' && !m.ref_type)) return 'stock_in';
  if (m.ref_type === 'purchase_return' || (m.reason === 'return' && !m.ref_type)) return 'returned';
  if (m.reason === 'issue') return 'sold';
  return m.reason === 'opening' ? 'opening' : 'adjusted';
};
const KIND_LABEL = { opening: 'report.opening', stock_in: 'menu.stockIn', returned: 'menu.return', sold: 'report.sold', adjusted: 'report.adjusted' };

/** The item's stock history, shown under its row */
function History({ itemId }) {
  const { t } = useT();
  const h = useAsync(() => api(`/items/${itemId}/movements`), [itemId]);
  if (h.loading) return <Loading />;
  if (h.error) return <ErrorBox error={h.error} onRetry={h.reload} />;
  if (!h.data.rows.length) return <p className="muted">{t('report.noHistory')}</p>;
  return (
    <table className="table sr-history">
      <thead>
        <tr>
          <th>{t('report.when')}</th>
          <th>{t('report.type')}</th>
          <th>{t('report.details')}</th>
          <th>{t('purchase.vendor')}</th>
          <th className="num">{t('report.change')}</th>
          <th className="num">{t('report.balance')}</th>
          <th>{t('report.by')}</th>
        </tr>
      </thead>
      <tbody>
        {h.data.rows.map((m) => {
          const kind = kindOf(m);
          const change = Number(m.qty_change);
          return (
            <tr key={m.id}>
              <td>{fmtDate(m.created_at, true)}</td>
              <td><span className={`sr-kind sr-kind-${kind}`}>{t(KIND_LABEL[kind])}</span></td>
              <td>{m.note || '—'}</td>
              <td>{m.supplier_name || '—'}</td>
              <td className={`num ${change > 0 ? 'sr-in' : 'sr-out'}`}><b>{change > 0 ? `+${change}` : change}</b></td>
              <td className="num">{Number(m.balance_after)}</td>
              <td>{m.created_by_name || '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const qty = (n) => {
  const v = Number(n || 0);
  return v ? String(v) : '—';
};

export default function StockReport() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [show, setShow] = useState('moved');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);   // item whose stock history is shown
  const dq = useDebounced(q);
  const list = useAsync(() => api('/items/stock-report', { query: { q: dq, category, show, page, limit: 50 } }), [dq, category, show, page]);
  const cats = useAsync(() => api('/items/categories'), []);
  const tot = list.data?.totals;
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <>
      <PageHeader compact title={t('menu.stockReport')} subtitle={list.data ? t('report.itemCount', { n: list.data.total }) : ''} />
      <Card className="crud-compact sr-card">
        <div className="toolbar">
          <SearchBox value={q} onChange={reset(setQ)} placeholder={t('report.searchHint')} />
          <select value={category} onChange={(e) => reset(setCategory)(e.target.value)} aria-label={t('items.category')}>
            <option value="">{t('items.allCategories')}</option>
            {(cats.data?.rows || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={show} onChange={(e) => reset(setShow)(e.target.value)} aria-label={t('report.show')}>
            {SHOW.map((s) => <option key={s} value={s}>{t(`report.show_${s}`)}</option>)}
          </select>
        </div>
        <p className="muted sr-formula">{t('report.formula')}</p>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          list.data.rows.length ? (
            <>
              <div className="table-wrap">
                <table className="table sr-table">
                  <thead>
                    <tr>
                      <th>{t('items.code')}</th>
                      <th>{t('items.name')}</th>
                      <th>{t('items.category')}</th>
                      <th>{t('items.pack')}</th>
                      <th className="num">{t('report.opening')}</th>
                      <th className="num sr-in">{t('menu.stockIn')}</th>
                      <th className="num sr-out">{t('menu.return')}</th>
                      <th className="num sr-out">{t('report.sold')}</th>
                      <th className="num">{t('report.adjusted')}</th>
                      <th className="num sr-now">{t('report.current')}</th>
                      <th className="num">{t('report.price')}</th>
                      <th className="num">{t('report.value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.rows.map((r) => {
                      const open = openId === r.id;
                      const toggle = () => setOpenId(open ? null : r.id);
                      return [
                        <tr key={r.id} className={`sr-row ${Number(r.stock_qty) <= 0 ? 'sr-empty' : ''} ${open ? 'open' : ''}`}
                          tabIndex={0} aria-expanded={open} title={t('report.historyHint')} onClick={toggle}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
                          <td className="muted">{r.item_code}</td>
                          <td><Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="si-chevron" /><b>{r.name}</b></td>
                          <td>{r.category || '—'}</td>
                          <td>{r.pack || r.unit || '—'}</td>
                          <td className="num">{qty(r.opening)}</td>
                          <td className="num sr-in">{qty(r.stock_in)}</td>
                          <td className="num sr-out">{qty(r.returned)}</td>
                          <td className="num sr-out">{qty(r.sold)}</td>
                          <td className="num">{qty(r.adjusted)}</td>
                          <td className="num sr-now"><b>{Number(r.stock_qty || 0)}</b></td>
                          <td className="num">{money(r.price)}</td>
                          <td className="num"><b>{money(r.stock_value)}</b></td>
                        </tr>,
                        open && (
                          <tr key={`h-${r.id}`} className="sr-history-row">
                            <td colSpan={12}><History itemId={r.id} /></td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="sr-sum">
                      <td colSpan={4}><b>{t('stockin.sumTotal')}</b></td>
                      <td className="num">{qty(tot.opening)}</td>
                      <td className="num">{qty(tot.stock_in)}</td>
                      <td className="num">{qty(tot.returned)}</td>
                      <td className="num">{qty(tot.sold)}</td>
                      <td className="num">{qty(tot.adjusted)}</td>
                      <td className="num"><b>{Number(tot.stock_qty || 0)}</b></td>
                      <td />
                      <td className="num"><b>{money(tot.stock_value)}</b></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
            </>
          ) : <Empty>{t('common.noRecords')}</Empty>
        )}
      </Card>
    </>
  );
}
