// Pharmacy → Stock In → Master: goods received against a purchase order. Pick the vendor, then one of its
// orders still not fully received – its items are listed to fill in what arrived: Received (split into R.Order,
// the paid units, then R.Free), Batch No, Mf.Date / Exp.Date (MM/YY) and S.Disc %. Saving adds R.Order + R.Free
// to stock and makes each Sel.Amount (MRP less S.Disc %) the item's selling price.
// Only an Admin may change a saved Stock In, and not once a Return or a Sale uses its batches (then read-only).
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove } from '../../lib/tableKeys.js';
import { mmyyToMonth, monthToMMYY, typeMMYY } from '../../lib/months.js';
import { Button, Card, ErrorBox, Input, Loading, Select, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';
import { selAmount, unitPrice } from '../../../../shared/stockin.js';

const two = (n) => Number(n || 0).toFixed(2);
const qtyText = (n) => String(Number(n || 0));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A row of the order, ready to fill in; `saved` (editing) brings back what was entered before. */
const toRow = (l, saved) => {
  const dueOrder = Math.max(0, r2(Number(l.ordered) - Number(l.received)));
  const dueFree = Math.max(0, r2(Number(l.ordered_free) - Number(l.received_free)));
  const rOrder = saved ? Number(saved.qty) : dueOrder;
  const rFree = saved ? Number(saved.free_qty) : dueFree;
  return {
    ...l, rate: Number(l.rate), mrp: Number(l.mrp), due_order: dueOrder, due_free: dueFree,
    po_disc: Number(l.disc_percent),   // the order's Disc %; disc_percent below is this Stock In's S.Disc %
    r_order: rOrder ? qtyText(rOrder) : '', r_free: rFree ? qtyText(rFree) : '', received_now: qtyText(r2(rOrder + rFree)),
    batch_no: saved?.batch_no || '', mfg: monthToMMYY(saved?.mfg_date), exp: monthToMMYY(saved?.exp_date),
    // editing: a month kept as it was is allowed even if it is now past (Exp) / future (Mf)
    saved_mfg: saved?.mfg_date ? String(saved.mfg_date).slice(0, 7) : '', saved_exp: saved?.exp_date ? String(saved.exp_date).slice(0, 7) : '',
    disc_percent: saved && Number(saved.disc_percent) ? qtyText(saved.disc_percent) : '',
  };
};

/** Typing Received fills R.Order first (up to what is due), the rest goes to R.Free */
function splitReceived(r, value) {
  const v = Number(value || 0);
  const order = Math.min(v, r.due_order);
  return { received_now: value, r_order: order ? qtyText(order) : '', r_free: v > order ? qtyText(r2(v - order)) : '' };
}

/** What is wrong with a row's months (Mf / Exp), as { mfg, exp } messages */
function monthErrors(r, thisMonth, t) {
  const mfg = mmyyToMonth(r.mfg);
  const exp = mmyyToMonth(r.exp);
  const out = {};
  if (mfg === null) out.mfg = t('stockin.mmyy');
  else if (mfg && mfg > thisMonth && mfg !== r.saved_mfg) out.mfg = t('stockin.mfgFuture');
  if (exp === null) out.exp = t('stockin.mmyy');
  else if (exp && exp < thisMonth && exp !== r.saved_exp) out.exp = t('stockin.expPast');
  else if (exp && mfg && exp <= mfg) out.exp = t('stockin.expAfterMfg');
  return out;
}

export default function StockInForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const { isGlobal: isAdmin } = useAuth();
  const id = params.id;
  const [head, setHead] = useState({ supplier_id: '', po_id: '', si_date: todayLocal() });
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // bulk fill: tick rows, then give Batch No / Mf.Date / Exp.Date / Discount % to all of them at once
  const [ticked, setTicked] = useState(() => new Set());
  const [fill, setFill] = useState({ batch_no: '', mfg: '', exp: '', disc_percent: '' });
  // column groups shown with the arrows: P.Rate | Disc% (sky), GST% | CGST% | SGST% (amber), Unit Price (emerald)
  const [open, setOpen] = useState({ rate: false, gst: false, unit: false });
  const existing = useAsync(() => (id ? api(`/stock-in/${id}`) : Promise.resolve(null)), [id]);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const orders = useAsync(
    () => (head.supplier_id
      ? api('/purchases', { query: { supplier_id: head.supplier_id, open: 1, include: existing.data?.po_id || '', limit: 100 } })
      : Promise.resolve({ rows: [] })),
    [head.supplier_id, existing.data?.po_id],
  );
  const readOnly = !!id && (!isAdmin || !!existing.data?.locked);

  // the chosen order's items (editing: with what this Stock In saved)
  async function loadRows(poId, saved = []) {
    setTicked(new Set());
    if (!poId) { setRows([]); return; }
    setRowsLoading(true);
    try {
      const r = await api(`/stock-in/order/${poId}`, { query: id ? { except: id } : {} });
      const bySaved = new Map(saved.map((s) => [s.po_item_id, s]));
      setRows(r.rows.map((l) => toRow(l, id ? bySaved.get(l.po_item_id) || { qty: 0, free_qty: 0 } : null)));
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

  const thisMonth = todayLocal().slice(0, 7);   // Exp.Date from this month on, Mf.Date up to this month
  const problems = rows.map((r) => ({
    ...monthErrors(r, thisMonth, t),
    order: Number(r.r_order || 0) > r.due_order ? t('stockin.overDue', { n: r.due_order }) : undefined,
    free: Number(r.r_free || 0) > r.due_free ? t('stockin.overDue', { n: r.due_free }) : undefined,
  }));
  const hasProblem = problems.some((p) => Object.values(p).some(Boolean));

  async function submit(e) {
    e.preventDefault();
    if (readOnly) return;
    if (!head.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    if (!head.po_id) { setError(t('stockin.chooseOrder')); return; }
    if (hasProblem) { setError(t('stockin.fixRed')); return; }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: rows.filter((r) => Number(r.r_order) > 0 || Number(r.r_free) > 0).map((r) => ({
        po_item_id: r.po_item_id, batch_no: r.batch_no, mfg_date: mmyyToMonth(r.mfg), exp_date: mmyyToMonth(r.exp),
        qty: r.r_order || 0, free_qty: r.r_free || 0, disc_percent: r.disc_percent,
      })),
    };
    try {
      const si = id ? await api(`/stock-in/${id}`, { method: 'PUT', body }) : await api('/stock-in', { method: 'POST', body });
      toast(t('stockin.saved', { no: si.si_no }));
      if (id) navigate('/stock-in');
      else { setHead({ supplier_id: '', po_id: '', si_date: todayLocal() }); setRows([]); setTicked(new Set()); orders.reload(); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };
  const orderOptions = (orders.data?.rows || []).map((o) => ({
    value: String(o.id), label: `${o.po_no} · ${fmtDate(o.po_date)} · ${money(o.total_amount)}`,
  }));
  const arrow = (key, label) => (
    <span className="po-item-head">
      <span>{label}</span>
      <button type="button" className={`po-more po-more-${key} ${open[key] ? 'open' : ''}`} aria-expanded={open[key]}
        title={open[key] ? t('purchase.hideDetails') : t('purchase.showDetails')}
        aria-label={open[key] ? t('purchase.hideDetails') : t('purchase.showDetails')}
        onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
        <Icon name={open[key] ? 'chevronLeft' : 'chevronRight'} size={14} />
      </button>
    </span>
  );
  const earlier = (n) => (Number(n) > 0 ? <small className="si-earlier">{t('stockin.earlier', { n: qtyText(n) })}</small> : null);

  // the table's columns (shares of the width add up to 100 % whichever groups are open)
  const cols = [
    { key: 'tick', w: 2, className: 'si-tick',
      head: <input type="checkbox" aria-label={t('bulkFill.tickAll')} title={t('bulkFill.tickAll')} checked={allTicked}
        onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.po_item_id)))} />,
      cell: (r, n) => <input type="checkbox" aria-label={`${n + 1}. ${r.item_name}`} checked={ticked.has(r.po_item_id)} onChange={() => toggleRow(r.po_item_id)} /> },
    { key: 'item', w: 11, className: 'po-item po-wrap', head: t('items.name'), cell: (r) => r.item_name },
    { key: 'pack', w: 4, className: 'po-wrap', head: t('items.pack'), cell: (r) => r.pack || '—' },
    { key: 'unit', w: 3.5, className: 'po-wrap', head: t('purchase.unit'), cell: (r) => r.unit || '—' },
    { key: 'mrp', w: 4.5, className: 'num', head: t('items.mrp'), cell: (r) => two(r.mrp) },
    { key: 'amount', w: 5.5, className: 'num', head: arrow('rate', t('purchase.amount')), cell: (r, n, c) => two(c.amount) },
    ...(open.rate ? [
      { key: 'p_rate', w: 4.5, className: 'num si-sky', head: t('purchase.pRate'), cell: (r) => two(r.p_rate) },
      { key: 'disc', w: 3.5, className: 'num si-sky', head: t('purchase.disc'), cell: (r) => qtyText(r.po_disc) },
    ] : []),
    { key: 'gst_amt', w: 5, className: 'num', head: arrow('gst', t('purchase.gstAmount')), cell: (r, n, c) => two(c.gstAmount) },
    ...(open.gst ? [
      { key: 'gst', w: 3.5, className: 'num si-amber', head: t('purchase.gst'), cell: (r) => qtyText(r.gst_percent) },
      { key: 'cgst', w: 3.5, className: 'num si-amber', head: t('items.cgst'), cell: (r) => qtyText(r.cgst_percent) },
      { key: 'sgst', w: 3.5, className: 'num si-amber', head: t('items.sgst'), cell: (r) => qtyText(r.sgst_percent) },
    ] : []),
    { key: 'total', w: 5.5, className: 'num', head: t('purchase.total'), cell: (r, n, c) => <b>{two(c.total)}</b> },
    { key: 'ordered', w: 4.5, className: 'num', head: t('stockin.ordered'), cell: (r) => <>{qtyText(r.ordered)}{earlier(r.received)}</> },
    { key: 'free', w: 4, className: 'num', head: t('purchase.free'), cell: (r) => <>{qtyText(r.ordered_free)}{earlier(r.received_free)}</> },
    { key: 'received', w: 5, head: t('stockin.received'),
      cell: (r) => <input {...num} aria-label={t('stockin.received')} value={r.received_now}
        onChange={(e) => setRow(r.po_item_id, splitReceived(r, e.target.value))} /> },
    { key: 'r_order', w: 4.5, head: t('stockin.rOrder'), bad: 'order',
      cell: (r) => <input {...num} aria-label={t('stockin.rOrder')} value={r.r_order}
        onChange={(e) => setRow(r.po_item_id, { r_order: e.target.value, received_now: qtyText(r2(Number(e.target.value || 0) + Number(r.r_free || 0))) })} /> },
    { key: 'r_free', w: 4, head: t('stockin.rFree'), bad: 'free',
      cell: (r) => <input {...num} aria-label={t('stockin.rFree')} value={r.r_free}
        onChange={(e) => setRow(r.po_item_id, { r_free: e.target.value, received_now: qtyText(r2(Number(r.r_order || 0) + Number(e.target.value || 0))) })} /> },
    { key: 'batch', w: 6, head: t('stockin.batch'),
      cell: (r) => <input className="si-batch" aria-label={t('stockin.batch')} maxLength={50} value={r.batch_no}
        onChange={(e) => setRow(r.po_item_id, { batch_no: e.target.value })} /> },
    { key: 'mfg', w: 4.5, head: t('stockin.mfg'), bad: 'mfg',
      cell: (r) => <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.mfg')} value={r.mfg}
        onChange={(e) => setRow(r.po_item_id, { mfg: typeMMYY(e.target.value) })} /> },
    { key: 'exp', w: 4.5, head: t('stockin.exp'), bad: 'exp',
      cell: (r) => <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.exp')} value={r.exp}
        onChange={(e) => setRow(r.po_item_id, { exp: typeMMYY(e.target.value) })} /> },
    { key: 's_disc', w: 4, head: t('stockin.sDisc'),
      cell: (r) => <input {...num} max="100" aria-label={t('stockin.sDisc')} value={r.disc_percent}
        onChange={(e) => setRow(r.po_item_id, { disc_percent: e.target.value })} /> },
    { key: 'sel', w: 5.5, className: 'num', head: arrow('unit', t('stockin.sel')), cell: (r, n, c) => <b>{two(c.sel)}</b> },
    ...(open.unit ? [
      { key: 'unit_price', w: 4.5, className: 'num si-emerald', head: t('stockin.unitPrice'), cell: (r, n, c) => two(unitPrice(c.sel, r.unit)) },
    ] : []),
  ];
  const share = 100 / cols.reduce((s, c) => s + c.w, 0);
  const calc = (r) => {
    const amount = r2(Number(r.r_order || 0) * r.rate);
    const gstAmount = r2((amount * Number(r.gst_percent || 0)) / 100);
    return { amount, gstAmount, total: r2(amount + gstAmount), sel: selAmount(r) };
  };
  const sums = rows.reduce((s, r) => {
    const c = calc(r);
    return { amount: s.amount + c.amount, gst: s.gst + c.gstAmount, total: s.total + c.total };
  }, { amount: 0, gst: 0, total: 0 });

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="download" size={16} /></span>
          <div>
            <h1>{id ? `${readOnly ? '' : `${t('common.edit')} – `}${existing.data?.si_no}` : t('stockin.new')}</h1>
            <p className="muted">{t('stockin.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/stock-in')}><Icon name="list" size={15} /> {t('stockin.viewList')}</Button>
          </div>
        </div>
        {readOnly && <div className="alert alert-info">{existing.data?.locked || t('stockin.adminOnly')}</div>}

        <fieldset className="plain-fieldset" disabled={readOnly}>
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
                <Input label={t('stockin.mfg')} inputMode="numeric" placeholder="MM/YY" value={fill.mfg} onChange={(e) => setFill((f) => ({ ...f, mfg: typeMMYY(e.target.value) }))} />
                <Input label={t('stockin.exp')} inputMode="numeric" placeholder="MM/YY" value={fill.exp} onChange={(e) => setFill((f) => ({ ...f, exp: typeMMYY(e.target.value) }))} />
                <Input label={t('stockin.sDisc')} type="number" min="0" max="100" step="0.01" value={fill.disc_percent} onChange={(e) => setFill((f) => ({ ...f, disc_percent: e.target.value }))} />
                <Button type="button" size="sm" onClick={applyFill} disabled={!Object.values(fill).some((v) => v !== '')}>
                  <Icon name="check" size={15} /> {t('bulkFill.apply', { n: ticked.size })}
                </Button>
              </div>
            </div>
          )}
          {!rowsLoading && rows.length > 0 && (
            <div className="table-wrap po-lines po-fit si-lines">
              <table className="table">
                <colgroup>{cols.map((c) => <col key={c.key} style={{ width: `${(c.w * share).toFixed(2)}%` }} />)}</colgroup>
                <thead>
                  <tr>{cols.map((c) => <th key={c.key} className={c.className}>{c.head}</th>)}</tr>
                </thead>
                <tbody onKeyDown={arrowMove}>
                  {rows.map((r, n) => {
                    const c = calc(r);
                    const p = problems[n];
                    return (
                      <tr key={r.po_item_id} className={ticked.has(r.po_item_id) ? 'si-ticked' : undefined}>
                        {cols.map((col) => {
                          const bad = col.bad && p[col.bad];
                          return (
                            <td key={col.key} className={[col.className, bad ? 'cell-bad' : ''].filter(Boolean).join(' ') || undefined} title={bad || undefined}>
                              {col.cell(r, n, c)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    {cols.map((col) => (
                      <td key={col.key} className="num">
                        {col.key === 'item' && <b>{t('purchase.sumTotal')}</b>}
                        {col.key === 'amount' && money(sums.amount)}
                        {col.key === 'gst_amt' && money(sums.gst)}
                        {col.key === 'total' && <b className="po-sum">{money(sums.total)}</b>}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </fieldset>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/stock-in')}>{readOnly ? t('common.back') : t('common.cancel')}</Button>}
          {!readOnly && (
            <Button type="submit" loading={saving} disabled={!rows.length || hasProblem}>
              {id ? t('common.save') : <><Icon name="download" size={16} /> {t('stockin.save')}</>}
            </Button>
          )}
        </div>
      </Card>
    </form>
  );
}
