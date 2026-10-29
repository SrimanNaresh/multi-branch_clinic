// Pharmacy → Report → Vendor Payments: per vendor, Stock In (+ GST) less Return (+ GST) = Net Payable,
// for an optional date range. Clicking a vendor opens its Stock Ins and Returns under its row.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Card, Empty, ErrorBox, Input, Loading, PageHeader, useAsync } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

/** One vendor's Stock Ins and Returns, shown under its row */
function VendorDetails({ supplierId, range }) {
  const { t } = useT();
  const d = useAsync(() => api(`/reports/vendor-payments/${supplierId}`, { query: range }), [supplierId, range.from, range.to]);
  if (d.loading) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  return (
    <table className="table sr-history">
      <thead>
        <tr>
          <th>{t('purchase.date')}</th>
          <th>{t('report.type')}</th>
          <th>{t('vp.docNo')}</th>
          <th>{t('vp.refNo')}</th>
          <th>{t('items.name')}</th>
          <th className="num">{t('purchase.items')}</th>
          <th className="num">{t('items.quantity')}</th>
          <th className="num">{t('vp.taxable')}</th>
          <th className="num">GST</th>
          <th className="num">{t('vp.total')}</th>
        </tr>
      </thead>
      <tbody>
        {d.data.rows.map((r) => {
          const isReturn = r.type === 'return';
          return (
            <tr key={`${r.type}-${r.id}`} className="vp-doc" title={t('vp.open')}
              onClick={() => navigate(isReturn ? `/returns/${r.id}/edit` : `/stock-in/${r.id}/edit`)}>
              <td>{fmtDate(r.doc_date)}</td>
              <td><span className={`sr-kind ${isReturn ? 'sr-kind-returned' : 'sr-kind-stock_in'}`}>{t(isReturn ? 'menu.return' : 'menu.stockIn')}</span></td>
              <td><b>{r.doc_no}</b></td>
              <td className="muted">{r.ref_no}</td>
              <td className="vp-items">{r.item_names}</td>
              <td className="num">{r.items}</td>
              <td className="num">{Number(r.qty)}</td>
              <td className="num">{money(r.taxable)}</td>
              <td className="num">{money(r.gst)}</td>
              <td className={`num ${isReturn ? 'sr-out' : 'sr-in'}`}><b>{isReturn ? '− ' : ''}{money(r.total)}</b></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function VendorPayments() {
  const { t } = useT();
  const [range, setRange] = useState({ from: '', to: '' });
  const [openId, setOpenId] = useState(null);
  const list = useAsync(() => api('/reports/vendor-payments', { query: range }), [range.from, range.to]);
  const tot = list.data?.totals;

  return (
    <>
      <PageHeader compact title={t('menu.vendorPayments')} subtitle={t('vp.subtitle')} />
      <Card className="crud-compact sr-card">
        <div className="toolbar vp-toolbar">
          <Input label={t('vp.from')} type="date" value={range.from} max={range.to || undefined}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <Input label={t('vp.to')} type="date" value={range.to} min={range.from || undefined}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <p className="muted sr-formula">{t('vp.formula')}</p>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (list.data.rows.length ? (
          <div className="table-wrap">
            <table className="table sr-table vp-table">
              <thead>
                <tr>
                  <th>{t('purchase.vendor')}</th>
                  <th className="num">{t('menu.stockIn')}</th>
                  <th className="num">{t('vp.taxable')}</th>
                  <th className="num">GST</th>
                  <th className="num sr-in">{t('vp.stockInTotal')}</th>
                  <th className="num">{t('menu.return')}</th>
                  <th className="num sr-out">{t('vp.returnTotal')}</th>
                  <th className="num sr-now">{t('vp.payable')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => {
                  const open = openId === r.supplier_id;
                  const toggle = () => setOpenId(open ? null : r.supplier_id);
                  return [
                    <tr key={r.supplier_id} className={`sr-row ${open ? 'open' : ''}`} tabIndex={0} aria-expanded={open}
                      title={t('vp.detailsHint')} onClick={toggle}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
                      <td>
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="si-chevron" />
                        <b>{r.supplier_name}</b>{r.mobile && <span className="muted"> · {r.mobile}</span>}
                      </td>
                      <td className="num">{r.stock_in_count}</td>
                      <td className="num">{money(r.stock_in.taxable)}</td>
                      <td className="num">{money(r.stock_in.gst)}</td>
                      <td className="num sr-in"><b>{money(r.stock_in.total)}</b></td>
                      <td className="num">{r.return_count}</td>
                      <td className="num sr-out"><b>{money(r.returned.total)}</b></td>
                      <td className="num sr-now"><b>{money(r.payable)}</b></td>
                    </tr>,
                    open && (
                      <tr key={`d-${r.supplier_id}`} className="sr-history-row">
                        <td colSpan={8}><VendorDetails supplierId={r.supplier_id} range={range} /></td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="sr-sum">
                  <td><b>{t('stockin.sumTotal')}</b></td>
                  <td className="num">{tot.stock_in_count}</td>
                  <td className="num">{money(tot.stock_in.taxable)}</td>
                  <td className="num">{money(tot.stock_in.gst)}</td>
                  <td className="num"><b>{money(tot.stock_in.total)}</b></td>
                  <td className="num">{tot.return_count}</td>
                  <td className="num"><b>{money(tot.returned.total)}</b></td>
                  <td className="num"><b>{money(tot.payable)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <Empty>{t('vp.none')}</Empty>)}
      </Card>
    </>
  );
}
