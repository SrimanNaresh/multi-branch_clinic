// Pharmacy → Stock In → Master: goods received against a purchase order. Pick the vendor, then one of its
// orders – its items are listed to fill in Batch No, Mf.Date, Exp.Date, Quantity, Sales % and Discount %.
// Saving adds the quantities to stock and makes each Sel.Amount the item's selling price.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove } from '../../lib/tableKeys.js';
import { Button, Card, ErrorBox, Input, Loading, Select, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';
import { selAmount } from '../../../../shared/stockin.js';

const two = (n) => Number(n || 0).toFixed(2);
const qtyText = (n) => String(Number(n || 0));

/** A row of the order, ready to fill in; `saved` (editing) brings back what was entered before. */
const toRow = (l, saved) => {
  const left = Math.max(0, Number(l.ordered) - Number(l.received));
  return {
    ...l, rate: Number(l.rate), mrp: Number(l.mrp),
    // Mf.Date / Exp.Date: month and year only ('2030-06')
    batch_no: saved?.batch_no || '', mfg_date: saved?.mfg_date ? String(saved.mfg_date).slice(0, 7) : '',
    exp_date: saved?.exp_date ? String(saved.exp_date).slice(0, 7) : '',
    saved_exp: saved?.exp_date ? String(saved.exp_date).slice(0, 7) : '',   // editing: kept as it was even if now past
    qty: saved ? qtyText(saved.qty) : (left ? qtyText(left) : ''),
    sales_percent: saved ? qtyText(saved.sales_percent) || '' : '',
    disc_percent: saved ? qtyText(saved.disc_percent) || '' : '',
  };
};

export default function StockInForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState({ supplier_id: '', po_id: '', si_date: todayLocal() });
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // bulk fill: tick rows, then give Batch No / Mf.Date / Exp.Date / Sales % / Discount % to all of them at once
  const [ticked, setTicked] = useState(() => new Set());
  const [fill, setFill] = useState({ batch_no: '', mfg_date: '', exp_date: '', sales_percent: '', disc_percent: '' });
  const [showMore, setShowMore] = useState(false);   // Generic Name, Manufacturer, HSN Code, Category: hidden until the arrow is clicked
  const existing = useAsync(() => (id ? api(`/stock-in/${id}`) : Promise.resolve(null)), [id]);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const orders = useAsync(
    () => (head.supplier_id ? api('/purchases', { query: { supplier_id: head.supplier_id, limit: 100 } }) : Promise.resolve({ rows: [] })),
    [head.supplier_id],
  );

  // the chosen order's items (editing: with what this Stock In saved)
  async function loadRows(poId, saved = []) {
    setTicked(new Set());
    if (!poId) { setRows([]); return; }
    setRowsLoading(true);
    try {
      const r = await api(`/stock-in/order/${poId}`, { query: id ? { except: id } : {} });
      const bySaved = new Map(saved.map((s) => [s.po_item_id, s]));
      setRows(r.rows.map((l) => toRow(l, bySaved.get(l.po_item_id))));
    } catch (err) {
      setError(err.message);
    } finally {
      setRowsLoading(false);
    }
  }

  useEffect(() => {
    const si = existing.data;
    if (!si) return;
    setHead({ supplier_id: String(si.supplier_id), po_id: String(si.po_id), si_date: String(si.si_date).slice(0, 10) });
    loadRows(si.po_id, si.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.po_item_id === key ? { ...r, ...patch } : r)));
  const toggleRow = (key) => setTicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.po_item_id));
  /** Applies the filled-in bulk boxes (only those) to every ticked row */
  function applyFill() {
    const patch = Object.fromEntries(Object.entries(fill).filter(([, v]) => v !== ''));
    if (!Object.keys(patch).length) return;
    setRows((rs) => rs.map((r) => (ticked.has(r.po_item_id) ? { ...r, ...patch } : r)));
    toast(t('bulkFill.applied', { n: ticked.size }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!head.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    if (!head.po_id) { setError(t('stockin.chooseOrder')); return; }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: rows.filter((r) => Number(r.qty) > 0).map(({ po_item_id, batch_no, mfg_date, exp_date, qty, sales_percent, disc_percent }) =>
        ({ po_item_id, batch_no, mfg_date, exp_date, qty, sales_percent, disc_percent })),
    };
    try {
      const si = id ? await api(`/stock-in/${id}`, { method: 'PUT', body }) : await api('/stock-in', { method: 'POST', body });
      toast(t('stockin.saved', { no: si.si_no }));
      if (id) navigate('/stock-in');
      else { setHead({ supplier_id: '', po_id: '', si_date: todayLocal() }); setRows([]); setTicked(new Set()); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };
  const thisMonth = todayLocal().slice(0, 7);   // Exp.Date from this month on, Mf.Date up to this month
  const orderOptions = (orders.data?.rows || []).map((o) => ({
    value: String(o.id), label: `${o.po_no} · ${fmtDate(o.po_date)} · ${money(o.total_amount)}`,
  }));

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="download" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.si_no}` : t('stockin.new')}</h1>
            <p className="muted">{t('stockin.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/stock-in')}><Icon name="list" size={15} /> {t('stockin.viewList')}</Button>
          </div>
        </div>

        <div className="form-grid si-head">
          <VendorPicker label={t('purchase.vendor')} required vendors={vendors.data?.rows || []} value={head.supplier_id}
            onPick={(v) => { setHead((h) => ({ ...h, supplier_id: String(v.id), po_id: '' })); setRows([]); }} />
          <Select label={t('stockin.orderNo')} required placeholder={head.supplier_id ? '—' : t('stockin.vendorFirst')}
            disabled={!head.supplier_id} value={head.po_id} options={orderOptions}
            onChange={(e) => { setHead((h) => ({ ...h, po_id: e.target.value })); loadRows(e.target.value); }} />
          <Input label={t('purchase.date')} type="date" required value={head.si_date}
            onChange={(e) => setHead((h) => ({ ...h, si_date: e.target.value }))} />
        </div>
        {head.supplier_id && !orders.loading && !orderOptions.length && <p className="muted">{t('stockin.noOrders')}</p>}

        {rowsLoading && <Loading />}
        {!rowsLoading && ticked.size > 0 && (
          <div className="si-fill">
            <div className="si-fill-title"><b>{t('bulkFill.title')}</b> <span className="muted">· {t('bulkFill.hint')}</span></div>
            <div className="si-fill-boxes">
              <Input label={t('stockin.batch')} maxLength={50} value={fill.batch_no} onChange={(e) => setFill((f) => ({ ...f, batch_no: e.target.value }))} />
              <Input label={t('stockin.mfg')} type="month" max={todayLocal().slice(0, 7)} value={fill.mfg_date} onChange={(e) => setFill((f) => ({ ...f, mfg_date: e.target.value }))} />
              <Input label={t('stockin.exp')} type="month" min={todayLocal().slice(0, 7)} value={fill.exp_date} onChange={(e) => setFill((f) => ({ ...f, exp_date: e.target.value }))} />
              <Input label={t('stockin.sales')} type="number" min="0" step="0.01" value={fill.sales_percent} onChange={(e) => setFill((f) => ({ ...f, sales_percent: e.target.value }))} />
              <Input label={t('stockin.disc')} type="number" min="0" max="100" step="0.01" value={fill.disc_percent} onChange={(e) => setFill((f) => ({ ...f, disc_percent: e.target.value }))} />
              <Button type="button" size="sm" onClick={applyFill} disabled={!Object.values(fill).some((v) => v !== '')}>
                <Icon name="check" size={15} /> {t('bulkFill.apply', { n: ticked.size })}
              </Button>
            </div>
          </div>
        )}
        {!rowsLoading && rows.length > 0 && (
          <div className="table-wrap po-lines si-lines">
            <table className="table">
              <thead>
                <tr>
                  <th className="si-tick">
                    <input type="checkbox" aria-label={t('bulkFill.tickAll')} title={t('bulkFill.tickAll')} checked={allTicked}
                      onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.po_item_id)))} />
                  </th>
                  <th className="po-item">
                    <span className="po-item-head">
                      <span>{t('items.name')}</span>
                      <button type="button" className={`po-more ${showMore ? 'open' : ''}`} aria-expanded={showMore}
                        title={showMore ? t('purchase.hideDetails') : t('purchase.showDetails')}
                        aria-label={showMore ? t('purchase.hideDetails') : t('purchase.showDetails')}
                        onClick={() => setShowMore(!showMore)}>
                        <Icon name={showMore ? 'chevronLeft' : 'chevronRight'} size={15} />
                      </button>
                    </span>
                  </th>
                  {showMore && (
                    <>
                      <th className="po-extra">{t('items.generic')}</th>
                      <th className="po-extra">{t('items.manufacturer')}</th>
                      <th className="po-extra">{t('items.hsn')}</th>
                      <th className="po-extra">{t('items.category')}</th>
                    </>
                  )}
                  <th>{t('items.pack')}</th>
                  <th className="num">{t('items.mrp')}</th>
                  <th className="num">{t('purchase.rate')}</th>
                  <th className="num">{t('stockin.ordered')}</th>
                  <th className="num">{t('stockin.received')}</th>
                  <th>{t('stockin.batch')}</th>
                  <th>{t('stockin.mfg')}</th>
                  <th>{t('stockin.exp')}</th>
                  <th className="num">{t('items.quantity')}</th>
                  <th className="num">{t('stockin.sales')}</th>
                  <th className="num">{t('stockin.disc')}</th>
                  <th className="num">{t('stockin.sel')}</th>
                </tr>
              </thead>
              <tbody onKeyDown={arrowMove}>
                {rows.map((r, n) => {
                  const sel = selAmount(r);
                  const overMrp = r.mrp > 0 && sel > r.mrp;
                  return (
                    <tr key={r.po_item_id} className={ticked.has(r.po_item_id) ? 'si-ticked' : undefined}>
                      <td className="si-tick">
                        <input type="checkbox" aria-label={`${n + 1}. ${r.item_name}`} checked={ticked.has(r.po_item_id)} onChange={() => toggleRow(r.po_item_id)} />
                      </td>
                      <td className="po-item">{r.item_name}</td>
                      {showMore && (
                        <>
                          <td className="po-extra po-wrap">{r.generic_name || '—'}</td>
                          <td className="po-extra po-wrap">{r.manufacturer || '—'}</td>
                          <td className="po-extra">{r.hsn_code || '—'}</td>
                          <td className="po-extra">{r.category || '—'}</td>
                        </>
                      )}
                      <td>{r.pack || '—'}</td>
                      <td className="num">{two(r.mrp)}</td>
                      <td className="num">{two(r.rate)}</td>
                      <td className="num">{qtyText(r.ordered)}</td>
                      <td className="num">{qtyText(r.received)}</td>
                      <td><input className="si-batch" aria-label={t('stockin.batch')} maxLength={50} value={r.batch_no}
                        onChange={(e) => setRow(r.po_item_id, { batch_no: e.target.value })} /></td>
                      <td><input type="month" className="si-date" aria-label={t('stockin.mfg')} value={r.mfg_date} max={thisMonth}
                        onChange={(e) => setRow(r.po_item_id, { mfg_date: e.target.value })} /></td>
                      <td><input type="month" className="si-date" aria-label={t('stockin.exp')} value={r.exp_date}
                        min={[r.mfg_date > thisMonth ? r.mfg_date : thisMonth, r.saved_exp].filter(Boolean).sort()[0]} title={t('stockin.expHint')}
                        onChange={(e) => setRow(r.po_item_id, { exp_date: e.target.value })} /></td>
                      <td><input {...num} aria-label={t('items.quantity')} value={r.qty} onChange={(e) => setRow(r.po_item_id, { qty: e.target.value })} /></td>
                      <td><input {...num} aria-label={t('stockin.sales')} value={r.sales_percent} onChange={(e) => setRow(r.po_item_id, { sales_percent: e.target.value })} /></td>
                      <td><input {...num} max="100" aria-label={t('stockin.disc')} value={r.disc_percent} onChange={(e) => setRow(r.po_item_id, { disc_percent: e.target.value })} /></td>
                      <td className={`num ${overMrp ? 'si-over' : ''}`} title={overMrp ? t('stockin.overMrp') : undefined}><b>{two(sel)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/stock-in')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving} disabled={!rows.length}>
            {id ? t('common.save') : <><Icon name="download" size={16} /> {t('stockin.save')}</>}
          </Button>
        </div>
      </Card>
    </form>
  );
}
