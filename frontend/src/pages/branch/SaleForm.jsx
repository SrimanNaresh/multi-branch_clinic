// Pharmacy → Sales → Master: a counter sale. First row: Date, Customer Name, Mobile No. Then the items:
// pick an item, then its batch (with stock, earliest expiry first) – Rack, Box, Stock and Sale Price fill in;
// Amount = Qty × Sale Price. Saving takes the quantities out of stock.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, todayLocal } from '../../lib/format.js';
import { arrowMove } from '../../lib/tableKeys.js';
import { Button, Card, ErrorBox, Input, Loading, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';

const r2 = (n) => Math.round(n * 100) / 100;
const month = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');
const newLine = () => ({
  key: Math.random().toString(36).slice(2), item_id: null, item_name: '', batches: [], item_stock: null, rack: '', box: '',
  stock_in_item_id: '', price: '', qty: '',
});
const EMPTY_HEAD = () => ({ sale_date: todayLocal(), customer_name: '', mobile: '' });

export default function SaleForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState(EMPTY_HEAD);
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/sales/${id}`) : Promise.resolve(null)), [id]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLineAfter = (key) => setLines((ls) => ls.flatMap((l) => (l.key === key ? [l, newLine()] : [l])));
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));

  /** The item's batches with stock; the first (earliest expiry) is chosen unless `keep` says which */
  async function loadBatches(key, itemId, keep) {
    const r = await api(`/sales/batches/${itemId}`, { query: id ? { except: id } : {} });
    const pick = keep ?? r.rows[0];
    setLine(key, {
      batches: r.rows, item_stock: r.stock_qty, item_price: r.price, rack: r.rack || '', box: r.box || '',
      ...(keep ? {} : { stock_in_item_id: pick ? String(pick.stock_in_item_id) : '', price: String(Number(pick?.sel_amount || r.price || 0)) }),
    });
  }

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setHead({ sale_date: String(s.sale_date).slice(0, 10), customer_name: s.customer_name, mobile: s.mobile || '' });
    const ls = s.lines.map((l) => ({
      ...newLine(), key: String(l.id), item_id: l.item_id, item_name: l.item_name,
      stock_in_item_id: l.stock_in_item_id ? String(l.stock_in_item_id) : '', price: String(Number(l.price)), qty: String(Number(l.qty)),
    }));
    setLines(ls.length ? ls : [newLine()]);
    ls.forEach((l) => loadBatches(l.key, l.item_id, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const amountOf = (l) => r2(Number(l.qty || 0) * Number(l.price || 0));
  const filled = lines.filter((l) => l.item_id);
  /** Stock the line can sell from: its batch's, or the item's when no batch is chosen (null until loaded) */
  const stockOf = (l) => {
    const batch = l.batches.find((b) => String(b.stock_in_item_id) === String(l.stock_in_item_id));
    return batch ? Number(batch.available) : l.item_stock;
  };
  // Quantity must not be more than Stock – counting every line that sells from the same batch / item
  const usedOf = (l) => filled
    .filter((x) => (l.stock_in_item_id ? x.stock_in_item_id === l.stock_in_item_id : !x.stock_in_item_id && x.item_id === l.item_id))
    .reduce((s, x) => s + Number(x.qty || 0), 0);
  const isOver = (l) => l.item_id && stockOf(l) != null && usedOf(l) > stockOf(l);
  const overLines = filled.filter(isOver);
  const total = r2(filled.reduce((s, l) => s + amountOf(l), 0));

  async function submit(e) {
    e.preventDefault();
    if (overLines.length) {
      setError(overLines.map((l) => t('sale.overStockLine', { name: l.item_name, n: stockOf(l) })).join(' · '));
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: filled.map(({ item_id, stock_in_item_id, qty, price }) => ({ item_id, stock_in_item_id: stock_in_item_id || null, qty, price })),
    };
    try {
      const s = id ? await api(`/sales/${id}`, { method: 'PUT', body }) : await api('/sales', { method: 'POST', body });
      toast(t('sale.saved', { no: s.sale_no, amount: money(s.total_amount) }));
      if (id) navigate('/sales');
      else { setHead(EMPTY_HEAD()); setLines([newLine()]); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };

  return (
    <form onSubmit={submit}>
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

        <div className="form-grid sale-head">
          <Input label={t('purchase.date')} type="date" required value={head.sale_date}
            onChange={(e) => setHead((h) => ({ ...h, sale_date: e.target.value }))} />
          <Input label={t('sale.customer')} required maxLength={150} autoFocus={!id} value={head.customer_name}
            onChange={(e) => setHead((h) => ({ ...h, customer_name: e.target.value }))} />
          <Input label={t('suppliers.mobile')} type="tel" maxLength={20} inputMode="tel" value={head.mobile}
            onChange={(e) => setHead((h) => ({ ...h, mobile: e.target.value }))} />
        </div>

        <div className="table-wrap po-lines sale-lines">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th className="po-item">{t('items.name')}</th>
                <th>{t('sale.batch')}</th>
                <th>{t('items.rack')}</th>
                <th>{t('items.box')}</th>
                <th className="num">{t('sale.stock')}</th>
                <th className="num">{t('sale.price')}</th>
                <th className="num">{t('items.quantity')}</th>
                <th className="num">{t('purchase.amount')}</th>
                <th aria-label={t('common.delete')} />
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {lines.map((l, n) => {
                const stock = stockOf(l);
                const over = isOver(l);
                return (
                  <tr key={l.key}>
                    <td className="muted">{n + 1}</td>
                    <td className="po-item">
                      <ItemPicker browse value={l.item_name} ariaLabel={t('items.name')} placeholder={t('purchase.itemHint')}
                        onPick={({ item, medicine_name: typed }) => {
                          if (!item) { setLine(l.key, { ...newLine(), key: l.key, item_name: typed }); return; }
                          setLine(l.key, { item_id: item.id, item_name: item.name, batches: [], stock_in_item_id: '', price: '', qty: l.qty || '1', rack: item.rack || '', box: item.box || '' });
                          loadBatches(l.key, item.id);
                        }} />
                    </td>
                    <td>
                      <select className="sale-batch" aria-label={t('sale.batch')} disabled={!l.item_id} value={l.stock_in_item_id}
                        onChange={(e) => {
                          const b = l.batches.find((x) => String(x.stock_in_item_id) === e.target.value);
                          setLine(l.key, { stock_in_item_id: e.target.value, price: String(Number(b?.sel_amount || l.item_price || 0)) });
                        }}>
                        <option value="">{l.item_id && !l.batches.length ? t('sale.noBatch') : '—'}</option>
                        {l.batches.map((b) => (
                          <option key={b.stock_in_item_id} value={b.stock_in_item_id}>
                            {b.batch_no || t('sale.noBatchNo')}{b.exp_date ? ` · ${t('sale.exp')} ${month(b.exp_date)}` : ''} · {Number(b.available)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="sale-loc">{l.rack || '—'}</td>
                    <td className="sale-loc">{l.box || '—'}</td>
                    <td className="num">{stock == null ? '—' : <b>{stock}</b>}</td>
                    <td><input {...num} aria-label={t('sale.price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} /></td>
                    <td className={over ? 'si-over' : undefined}>
                      <input {...num} max={stock ?? undefined} aria-label={t('items.quantity')} aria-invalid={over || undefined}
                        className={over ? 'sale-qty-over' : undefined} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      {over && <small className="sale-over-msg">{t('sale.overStock', { n: stock })}</small>}
                    </td>
                    <td className="num"><b>{amountOf(l).toFixed(2)}</b></td>
                    <td>
                      <span className="po-row-actions">
                        <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')} onClick={() => addLineAfter(l.key)}>
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
                <td colSpan={7} className="num"><b>{t('sale.total')}</b></td>
                <td className="num"><b>{filled.reduce((s, l) => s + Number(l.qty || 0), 0)}</b></td>
                <td className="num po-sum">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/sales')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving} disabled={overLines.length > 0}>{id ? t('common.save') : <><Icon name="pill" size={16} /> {t('sale.save')}</>}</Button>
        </div>
      </Card>
    </form>
  );
}
