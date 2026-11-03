// Pharmacy → Sales → Master: a counter sale. First row: Date, Customer Name, Mobile No. Then the items: pick an
// item, then its batch (with stock, earliest expiry first) and Sell by (Pack or Unit) – Rack, Box, Stock, MRP,
// Purchase Price and Sale Price fill in, per pack or per unit; Amount = Quantity × Sale Price less Disc %.
// TOTAL = Sub Total less Bill Discount %. Nothing may go above MRP or below the purchase cost (shared/sale.js,
// checked again by the server). Saving takes the packs out of stock; Save & Print also prints the receipt.
// Quick billing: Item (type + Enter) → Batch → Sell by → Quantity → Disc% → next row, each with Enter;
// on Batch and Sell by ↑ / ↓ change the choice.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, todayLocal } from '../../lib/format.js';
import { arrowMove, focusNewRow } from '../../lib/tableKeys.js';
import { monthToMMYY } from '../../lib/months.js';
import { Button, Card, ErrorBox, Input, Loading, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import { useReceiptPrinter } from '../../components/SaleReceipt.jsx';
import { lineAmount, lineCost, packsOf, perSaleUnit, saleTotals, unitsPerPack } from '../../../../shared/sale.js';

const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num4 = (n) => String(r4(n));
const two = (n) => Number(n || 0).toFixed(2);
const newLine = () => ({
  key: Math.random().toString(36).slice(2), item_id: null, item_name: '', info: null,
  stock_in_item_id: '', sale_unit: 'pack', price: '', qty: '', disc_percent: '',
});
const EMPTY_HEAD = () => ({ sale_date: todayLocal(), customer_name: '', mobile: '', disc_percent: '' });

/** The line's batch (or null: older stock with no batch) and its prices per pack */
function packPrices(l) {
  const info = l.info;
  const batch = info?.rows.find((b) => String(b.stock_in_item_id) === String(l.stock_in_item_id)) || null;
  return {
    batch,
    stock: batch ? Number(batch.available) : info?.stock_qty ?? null,
    mrp: Number(batch ? batch.mrp : info?.mrp || 0),
    cost: Number(batch ? batch.cost : info?.cost || 0),
    sel: Number(batch ? batch.sel_amount : info?.price || 0),
  };
}

export default function SaleForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState(EMPTY_HEAD);
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState(null);   // after a plain Save: the bar offers Print
  const printAfter = useRef(false);                     // Save & Print was pressed
  const batchCache = useRef(new Map());                 // each item's batch list, fetched once per bill
  const printer = useReceiptPrinter();
  const existing = useAsync(() => (id ? api(`/sales/${id}`) : Promise.resolve(null)), [id]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLineAfter = (key) => setLines((ls) => ls.flatMap((l) => (l.key === key ? [l, newLine()] : [l])));
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));
  const focusIn = (key, selector) => setTimeout(() => document.querySelector(`tr[data-line="${key}"] ${selector}`)?.focus(), 0);

  /** The item's batches, stock and prices (cached for this bill) */
  async function batchInfo(itemId) {
    if (!batchCache.current.has(itemId)) {
      batchCache.current.set(itemId, api(`/sales/batches/${itemId}`, { query: id ? { except: id } : {} })
        .catch((err) => { batchCache.current.delete(itemId); throw err; }));
    }
    return batchCache.current.get(itemId);
  }

  /** Loads the item's batches into the line; the first (earliest expiry) is chosen unless `keep` (editing) */
  async function loadBatches(key, itemId, keep = false) {
    try {
      const info = await batchInfo(itemId);
      setLines((ls) => ls.map((l) => {
        if (l.key !== key) return l;
        if (keep) return { ...l, info };
        const pick = info.rows[0];
        const next = { ...l, info, stock_in_item_id: pick ? String(pick.stock_in_item_id) : '', sale_unit: 'pack' };
        return { ...next, price: two(packPrices(next).sel) };
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setHead({ sale_date: String(s.sale_date).slice(0, 10), customer_name: s.customer_name, mobile: s.mobile || '', disc_percent: Number(s.disc_percent) ? String(Number(s.disc_percent)) : '' });
    const ls = s.lines.map((l) => ({
      ...newLine(), key: String(l.id), item_id: l.item_id, item_name: l.item_name,
      stock_in_item_id: l.stock_in_item_id ? String(l.stock_in_item_id) : '', sale_unit: l.sale_unit || 'pack',
      price: String(Number(l.price)), qty: String(Number(l.unit_qty ?? l.qty)), disc_percent: Number(l.disc_percent) ? String(Number(l.disc_percent)) : '',
    }));
    setLines(ls.length ? ls : [newLine()]);
    ls.forEach((l) => loadBatches(l.key, l.item_id, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  // ---- per line: what is shown (per pack or per unit) and what is wrong ----
  const view = (l) => {
    const p = packPrices(l);
    const size = l.info?.pack_size || 1;
    const f = unitsPerPack(l.sale_unit, size);
    return {
      ...p, size, f,
      stockShown: p.stock == null ? null : r4(p.stock * f),
      mrpShown: perSaleUnit(p.mrp, l.sale_unit, size),
      costShown: perSaleUnit(p.cost, l.sale_unit, size),
      calc: { qty: l.qty, price: l.price, disc_percent: l.disc_percent, sale_unit: l.sale_unit, pack_size: size, cost: p.cost },
    };
  };
  const filled = lines.filter((l) => l.item_id);
  const views = new Map(filled.map((l) => [l.key, view(l)]));
  // packs used from each batch (or item, with no batch) over every line
  const usedPacks = new Map();
  for (const l of filled) {
    const k = l.stock_in_item_id ? `b${l.stock_in_item_id}` : `i${l.item_id}`;
    usedPacks.set(k, r4((usedPacks.get(k) || 0) + packsOf({ qty: l.qty, sale_unit: l.sale_unit, pack_size: views.get(l.key).size })));
  }
  const problemsOf = (l) => {
    const v = views.get(l.key);
    if (!v || !l.info) return {};
    const out = {};
    const used = usedPacks.get(l.stock_in_item_id ? `b${l.stock_in_item_id}` : `i${l.item_id}`) || 0;
    if (v.stock != null && used > v.stock + 0.00005) out.qty = t('sale.overStock', { n: v.stockShown });
    if (v.mrp > 0 && Number(l.price) > v.mrpShown) out.price = t('sale.overMrp', { n: two(v.mrpShown) });
    if (Number(l.disc_percent) > 100) out.disc = t('sale.discRange');
    else if (Number(l.qty) > 0 && lineAmount(v.calc) < lineCost(v.calc)) out.amount = t('sale.belowCost', { n: two(lineCost(v.calc)) });
    return out;
  };
  const problems = new Map(filled.map((l) => [l.key, problemsOf(l)]));
  const sums = saleTotals(filled.map((l) => views.get(l.key).calc), head.disc_percent);
  const billDiscBad = Number(head.disc_percent) > 100 || Number(head.disc_percent) < 0;
  const totalBelowCost = filled.length > 0 && sums.total_amount < sums.cost;
  const hasProblem = billDiscBad || totalBelowCost || [...problems.values()].some((p) => Object.keys(p).length);

  /** Batch / Sell by changed: prices follow, Sale Price goes back to the batch's Sel.Amount */
  function choose(l, patch) {
    const next = { ...l, ...patch };
    const v = view(next);
    setLine(l.key, { ...patch, price: two(perSaleUnit(v.sel, next.sale_unit, v.size)) });
  }

  // Enter moves along: Item → Batch → Sell by → Quantity → Disc% → next row's Item (added if needed)
  function onEnter(e) {
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.shiftKey) return;
    const el = e.target;
    if (el.tagName === 'BUTTON') return;
    e.preventDefault();                 // never submit the bill from a table box
    const key = el.closest('tr')?.dataset.line;
    const step = el.dataset.step;
    if (!key || !step) return;
    if (step === 'batch') focusIn(key, '.sale-unit:not(:disabled), .sale-qty');
    else if (step === 'unit') focusIn(key, '.sale-qty');
    else if (step === 'qty') focusIn(key, '.sale-disc');
    else if (step === 'disc') {
      const at = lines.findIndex((x) => x.key === key);
      if (at === lines.length - 1) {
        const added = newLine();
        setLines((ls) => [...ls, added]);
        focusIn(added.key, '.po-item input');
      } else focusIn(lines[at + 1].key, '.po-item input');
    }
  }

  async function submit(e) {
    e.preventDefault();
    const print = printAfter.current;
    printAfter.current = false;
    if (hasProblem) { setError(t('sale.fixRed')); return; }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: filled.map(({ item_id, stock_in_item_id, sale_unit, qty, price, disc_percent }) =>
        ({ item_id, stock_in_item_id: stock_in_item_id || null, sale_unit, qty, price, disc_percent })),
    };
    try {
      const s = id ? await api(`/sales/${id}`, { method: 'PUT', body }) : await api('/sales', { method: 'POST', body });
      toast(t('sale.saved', { no: s.sale_no, amount: money(s.total_amount) }));
      batchCache.current.clear();
      if (id) {
        if (print) printer.print(s, () => navigate('/sales'));
        else navigate('/sales');
      } else {
        setHead(EMPTY_HEAD());
        setLines([newLine()]);
        setLastSaved(print ? null : s);
        if (print) printer.print(s);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };
  const badCell = (msg) => (msg ? { className: 'cell-bad', title: msg } : {});

  return (
    <form onSubmit={submit}>
      {printer.node}
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="pill" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.sale_no}` : t('sale.new')}</h1>
            <p className="muted">{t('sale.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/sales')}><Icon name="list" size={15} /> {t('sale.viewList')}</Button>
          </div>
        </div>

        {lastSaved && (
          <div className="sale-saved-bar">
            <span><Icon name="check" size={15} /> {t('sale.savedBar', { no: lastSaved.sale_no, amount: money(lastSaved.total_amount) })}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => printer.print(lastSaved)}><Icon name="print" size={15} /> {t('sale.print')}</Button>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setLastSaved(null)}><Icon name="x" size={15} /></button>
          </div>
        )}

        <div className="form-grid sale-head">
          <Input label={t('purchase.date')} type="date" required value={head.sale_date}
            onChange={(e) => setHead((h) => ({ ...h, sale_date: e.target.value }))} />
          <Input label={t('sale.customer')} required maxLength={150} autoFocus={!id} value={head.customer_name}
            onChange={(e) => setHead((h) => ({ ...h, customer_name: e.target.value }))} />
          <Input label={t('suppliers.mobile')} type="tel" maxLength={20} inputMode="tel" value={head.mobile}
            onChange={(e) => setHead((h) => ({ ...h, mobile: e.target.value }))} />
        </div>

        <div className="table-wrap po-lines po-fit sale-lines">
          <table className="table">
            <colgroup>
              {[2.5, 17, 11, 7, 4.5, 4.5, 5, 6, 6.5, 6.5, 5.5, 5, 7, 5].map((w, i) => <col key={i} style={{ width: `${w * (100 / 93)}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th className="po-item">{t('items.name')}</th>
                <th>{t('sale.batch')}</th>
                <th>{t('sale.sellBy')}</th>
                <th>{t('items.rack')}</th>
                <th>{t('items.box')}</th>
                <th className="num">{t('sale.stock')}</th>
                <th className="num">{t('items.mrp')}</th>
                <th className="num">{t('sale.purchasePrice')}</th>
                <th className="num">{t('sale.price')}</th>
                <th className="num">{t('items.quantity')}</th>
                <th className="num">{t('purchase.disc')}</th>
                <th className="num">{t('purchase.amount')}</th>
                <th aria-label={t('common.delete')} />
              </tr>
            </thead>
            <tbody onKeyDown={(e) => (e.key === 'Enter' ? onEnter(e) : arrowMove(e))}>
              {lines.map((l, n) => {
                const v = views.get(l.key);
                const p = problems.get(l.key) || {};
                const unitOk = (l.info?.pack_size || 1) > 1;
                return (
                  <tr key={l.key} data-line={l.key}>
                    <td className="muted">{n + 1}</td>
                    <td className="po-item">
                      <ItemPicker browse value={l.item_name} ariaLabel={t('items.name')} placeholder={t('purchase.itemHint')}
                        onPick={({ item, medicine_name: typed }) => {
                          if (!item) { setLine(l.key, { ...newLine(), key: l.key, item_name: typed }); return; }
                          setLine(l.key, { item_id: item.id, item_name: item.name, info: null, stock_in_item_id: '', sale_unit: 'pack', price: '', qty: l.qty || '1' });
                          loadBatches(l.key, item.id);
                          focusIn(l.key, '.sale-batch');
                        }} />
                    </td>
                    <td>
                      <select className="sale-batch" data-step="batch" data-keep-updown aria-label={t('sale.batch')} disabled={!l.item_id} value={l.stock_in_item_id}
                        onChange={(e) => choose(l, { stock_in_item_id: e.target.value })}>
                        {(!l.info || !l.info.rows.length) && <option value="">{l.info ? t('sale.noBatch') : '—'}</option>}
                        {(l.info?.rows || []).map((b) => (
                          <option key={b.stock_in_item_id} value={b.stock_in_item_id}>
                            {b.batch_no || t('sale.noBatchNo')}{b.exp_date ? ` · ${t('sale.exp')} ${monthToMMYY(b.exp_date)}` : ''} · {num4(b.available)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="sale-unit" data-step="unit" data-keep-updown aria-label={t('sale.sellBy')} disabled={!l.item_id} value={l.sale_unit}
                        onChange={(e) => choose(l, { sale_unit: e.target.value })}>
                        <option value="pack">{unitOk ? t('sale.packN', { n: l.info.pack_size }) : t('sale.pack')}</option>
                        {unitOk && <option value="unit">{t('sale.unit')}</option>}
                      </select>
                    </td>
                    <td className="sale-loc">{l.info?.rack ? <span className="loc-tag">{l.info.rack}</span> : '—'}</td>
                    <td className="sale-loc">{l.info?.box ? <span className="loc-tag">{l.info.box}</span> : '—'}</td>
                    <td className="num">{v?.stockShown == null ? '—' : <b>{num4(v.stockShown)}</b>}</td>
                    <td className="num">{v && l.info ? two(v.mrpShown) : '—'}</td>
                    <td className="num muted">{v && l.info ? two(v.costShown) : '—'}</td>
                    <td {...badCell(p.price)}>
                      <input {...num} aria-label={t('sale.price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    </td>
                    <td {...badCell(p.qty)}>
                      <input {...num} className="sale-qty" data-step="qty" aria-label={t('items.quantity')} aria-invalid={!!p.qty || undefined}
                        value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      {p.qty && <small className="sale-over-msg">{p.qty}</small>}
                    </td>
                    <td {...badCell(p.disc)}>
                      <input {...num} max="100" className="sale-disc" data-step="disc" aria-label={t('purchase.disc')} value={l.disc_percent}
                        onChange={(e) => setLine(l.key, { disc_percent: e.target.value })} />
                    </td>
                    <td className={`num${p.amount ? ' cell-bad' : ''}`} title={p.amount || undefined}>
                      <b>{v ? two(lineAmount(v.calc)) : '0.00'}</b>
                      {p.amount && <small className="sale-over-msg">{p.amount}</small>}
                    </td>
                    <td>
                      <span className="po-row-actions">
                        <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')} onClick={(e) => { addLineAfter(l.key); focusNewRow(e.currentTarget); }}>
                          <Icon name="plus" size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => removeLine(l.key)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={12} className="num"><b>{t('sale.subTotal')}</b></td>
                <td className="num"><b>{money(sums.sub_total)}</b></td>
                <td />
              </tr>
              <tr>
                <td colSpan={11} className="num"><b>{t('sale.billDisc')}</b></td>
                <td className={billDiscBad ? 'cell-bad' : undefined}>
                  <input {...num} max="100" aria-label={t('sale.billDisc')} value={head.disc_percent}
                    onChange={(e) => setHead((h) => ({ ...h, disc_percent: e.target.value }))} />
                </td>
                <td className="num">{sums.discount_amount ? `− ${money(sums.discount_amount)}` : '—'}</td>
                <td />
              </tr>
              <tr className="sale-total-row">
                <td colSpan={12} className="num"><b>{t('sale.total')}</b></td>
                <td className={`num po-sum${totalBelowCost ? ' cell-bad' : ''}`}>{money(sums.total_amount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted sale-keys-hint">{t('sale.keysHint')}</p>
        {totalBelowCost && <div className="alert alert-error">{t('sale.totalBelowCost', { total: money(sums.total_amount), cost: money(sums.cost) })}</div>}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/sales')}>{t('common.cancel')}</Button>}
          <Button type="submit" variant="ghost" loading={saving} disabled={hasProblem || !filled.length}>
            {id ? t('common.save') : <><Icon name="pill" size={16} /> {t('sale.save')}</>}
          </Button>
          <Button type="submit" loading={saving} disabled={hasProblem || !filled.length} onClick={() => { printAfter.current = true; }}>
            <Icon name="print" size={16} /> {id ? t('sale.updatePrint') : t('sale.savePrint')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
