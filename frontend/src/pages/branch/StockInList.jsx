// Pharmacy → Stock In → List, in two tabs: Item wise (a heading row per item with its totals, then each batch
// received) and Date wise (a heading row per Stock In date, then each item and batch received that day).
// Every row has its Buy, Sale, Discount and Net Sale amounts; the bar above totals everything the search matches.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

const month = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—');
const qtyText = (n) => String(Number(n || 0));
const r2 = (n) => Math.round(n * 100) / 100;

/** Amounts for a single quantity: Buy = Cur.Rate, Sale = Cur.Rate + Sales %, Net = Sel.Amount, Discount = Sale − Net */
const perUnit = (r) => {
  const sale = r2(Number(r.rate) * (1 + Number(r.sales_percent) / 100));
  return { buy: Number(r.rate), sale, net: Number(r.sel_amount), disc: r2(sale - Number(r.sel_amount)) };
};
/** The line's total with the single-quantity amount under it */
const Amount = ({ total, unit, strong, label }) => (
  <span className="si-amt">
    {strong ? <b>{money(total)}</b> : money(total)}
    <small title={label}>{money(unit)} / 1</small>
  </span>
);

const TABS = ['item', 'date'];
const dateKey = (d) => String(d ?? '').slice(0, 10);
const keyOf = (tab, r) => (tab === 'date' ? dateKey(r.si_date) : r.item_name);

/** [[group key, its rows], …] in the order the rows came (the server sorts them by item / by date) */
function groupRows(tab, rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(tab, r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups];
}

/** Consecutive rows of the same Stock In, as blocks */
function groupByStockIn(rows) {
  const blocks = [];
  for (const r of rows) {
    const last = blocks[blocks.length - 1];
    if (last && last[0].stock_in_id === r.stock_in_id) last.push(r);
    else blocks.push([r]);
  }
  return blocks;
}

export default function StockInList() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('item');       // 'item' (Item wise) | 'date' (Date wise)
  const [openItems, setOpenItems] = useState(() => new Set());   // Item wise: items whose batches are shown
  const dq = useDebounced(q);
  const list = useAsync(() => api('/stock-in/lines', { query: { q: dq, group: tab, page, limit: 50 } }), [dq, tab, page]);
  const tot = list.data?.totals;

  // Item wise: the item name is shown once, in its heading row. Date wise: the date is in the heading row, and
  // each Stock In's rows are kept together – its Stock In No (with the vendor) and Edit are one merged cell.
  const byDate = tab === 'date';
  const columns = [
    ...(byDate
      ? [
        {
          key: 'si_no', label: t('stockin.no'), merged: true, className: 'si-merged',
          render: (r) => <><b>{r.si_no}</b><small className="muted si-vendor">{r.supplier_name}</small></>,
        },
        { key: 'item_name', label: t('items.name'), render: (r) => <b>{r.item_name}</b> },
      ]
      : [{ key: 'item_name', label: t('items.name'), render: () => null }]),
    { key: 'batch_no', label: t('stockin.batch'), render: (r) => r.batch_no || '—' },
    { key: 'exp_date', label: t('stockin.exp'), render: (r) => month(r.exp_date) },
    ...(byDate ? [] : [
      { key: 'si_no', label: t('stockin.no'), render: (r) => <span className="muted" title={fmtDate(r.si_date)}>{r.si_no}</span> },
      { key: 'supplier_name', label: t('purchase.vendor') },
    ]),
    { key: 'qty', label: t('items.quantity'), className: 'num', render: (r) => qtyText(r.qty) },
    { key: 'buy_amount', label: t('stockin.buyAmount'), className: 'num', render: (r) => <Amount total={r.buy_amount} unit={perUnit(r).buy} label={t('stockin.perUnit')} /> },
    { key: 'sale_amount', label: t('stockin.saleAmount'), className: 'num', render: (r) => <Amount total={r.sale_amount} unit={perUnit(r).sale} label={t('stockin.perUnit')} /> },
    { key: 'disc_amount', label: t('stockin.discAmount'), className: 'num', render: (r) => <Amount total={r.disc_amount} unit={perUnit(r).disc} label={t('stockin.perUnit')} /> },
    { key: 'net_amount', label: t('stockin.netAmount'), className: 'num', render: (r) => <Amount strong total={r.net_amount} unit={perUnit(r).net} label={t('stockin.perUnit')} /> },
    // Edit only in Date wise: one per Stock In, merged down its block (Item wise has none)
    ...(byDate ? [{
      key: '_a', label: '', className: 'col-actions si-merged', merged: true,
      render: (r) => <Button size="sm" variant="ghost" onClick={() => navigate(`/stock-in/${r.stock_in_id}/edit`)}><Icon name="edit" size={15} /> {t('common.edit')}</Button>,
    }] : []),
  ];
  const amountCols = byDate ? 6 : 5;   // Quantity, the four amounts (and Edit): the heading row's own cells

  return (
    <>
      <PageHeader compact title={t('menu.stockIn')} subtitle={list.data ? t('stockin.lineCount', { n: list.data.total }) : ''}
        actions={<Button size="sm" onClick={() => navigate('/stock-in/new')}><Icon name="plus" size={16} /> {t('stockin.new')}</Button>} />
      <Card className="crud-compact si-list">
        <div className="tabs si-tabs" role="tablist">
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''}
              onClick={() => { setTab(k); setPage(1); }}>
              <Icon name={k === 'date' ? 'clock' : 'box'} size={15} /> {t(`stockin.tab_${k}`)}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('stockin.lineSearch')} />
        </div>
        {tot && list.data.total > 0 && (
          <div className="si-totals">
            <span>{t('items.quantity')} <b>{qtyText(tot.qty)}</b></span>
            <span>{t('stockin.buyAmount')} <b>{money(tot.buy_amount)}</b></span>
            <span>{t('stockin.saleAmount')} <b>{money(tot.sale_amount)}</b></span>
            <span>{t('stockin.discAmount')} <b>{money(tot.disc_amount)}</b></span>
            <span className="si-totals-net">{t('stockin.netAmount')} <b>{money(tot.net_amount)}</b></span>
          </div>
        )}
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            {list.data.rows.length ? (
              <div className="table-wrap">
                <table className={`table si-grouped si-by-${tab}`}>
                  <thead>
                    <tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {groupRows(tab, list.data.rows).map(([key, rows]) => {
                      const g = (list.data.groups || []).find((x) => (tab === 'date' ? dateKey(x.group_key) : x.group_key) === key) || {};
                      // Item wise: the batches show only after the item's heading is clicked
                      const open = byDate || openItems.has(key);
                      const toggle = () => setOpenItems((s) => {
                        const next = new Set(s);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      });
                      return [
                        <tr key={`g-${key}`} className={`si-group ${byDate ? '' : 'si-toggle'}`} aria-expanded={byDate ? undefined : open}
                          tabIndex={byDate ? undefined : 0} onClick={byDate ? undefined : toggle}
                          onKeyDown={byDate ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
                          <td colSpan={columns.length - amountCols}>
                            {!byDate && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} className="si-chevron" />}
                            <b>{tab === 'date' ? fmtDate(key) : key}</b>{' '}
                            <span className="muted">
                              · {tab === 'date' ? `${t('stockin.entries', { n: g.entries ?? 1 })} · ` : ''}{t('stockin.batches', { n: g.batches ?? rows.length })}
                            </span>
                          </td>
                          <td className="num"><b>{qtyText(g.qty)}</b></td>
                          <td className="num">{money(g.buy_amount)}</td>
                          <td className="num">{money(g.sale_amount)}</td>
                          <td className="num">{money(g.disc_amount)}</td>
                          <td className="num"><b>{money(g.net_amount)}</b></td>
                          {byDate && <td />}
                        </tr>,
                        // Date wise: one block per Stock In (rows come sorted by Stock In); merged cells on its first row
                        ...(!open ? [] : byDate ? groupByStockIn(rows) : [rows]).flatMap((block) => block.map((r, i) => (
                          <tr key={r.id} className={byDate && i === 0 ? 'si-block-first' : undefined}>
                            {columns.map((c) => {
                              if (c.merged && i > 0) return null;
                              return (
                                <td key={c.key} className={c.className} rowSpan={c.merged ? block.length : undefined}>
                                  {c.render ? c.render(r) : r[c.key]}
                                </td>
                              );
                            })}
                          </tr>
                        ))),
                      ];
                    })}
                  </tbody>
                  {/* Sum of every row the search matches (all pages) */}
                  <tfoot>
                    <tr className="si-sum">
                      <td colSpan={columns.length - amountCols}><b>{t('stockin.sumTotal')}</b></td>
                      <td className="num"><b>{qtyText(tot.qty)}</b></td>
                      <td className="num"><b>{money(tot.buy_amount)}</b></td>
                      <td className="num"><b>{money(tot.sale_amount)}</b></td>
                      <td className="num"><b>{money(tot.disc_amount)}</b></td>
                      <td className="num"><b>{money(tot.net_amount)}</b></td>
                      {byDate && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : <Empty>{t('common.noRecords')}</Empty>}
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
