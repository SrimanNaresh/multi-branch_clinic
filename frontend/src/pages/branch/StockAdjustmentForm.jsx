// Pharmacy → Stock In → Adjustment Entry: corrections and opening stock. Each row: the item, then the batch
// (or "No batch"), its current stock, and the packs to add (In) and / or take out (Out). Prices start at the
// batch's (or item's) purchase rate. Saving moves the stock; nothing may go below zero.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, todayLocal } from '../../lib/format.js';
import { arrowMove, focusNewRow } from '../../lib/tableKeys.js';
import { Button, Card, ErrorBox, Input, Loading, TextArea, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';

let seq = 0;
const newLine = () => ({ key: `n${++seq}`, item_id: '', item_name: '', info: null, stock_in_item_id: '', in_qty: '', in_price: '', out_qty: '', out_price: '' });
const qtyText = (n) => String(Number(n || 0));
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const month = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { month: '2-digit', year: '2-digit' }) : '');

export default function StockAdjustmentForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState({ adj_date: todayLocal(), remarks: '' });
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/stock-adjustments/${id}`) : Promise.resolve(null)), [id]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const loadInfo = async (key, itemId) => {
    try {
      const info = await api(`/stock-adjustments/item/${itemId}`, { query: id ? { except: id } : {} });
      setLine(key, { info });
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    setHead({ adj_date: String(a.adj_date).slice(0, 10), remarks: a.remarks || '' });
    const ls = a.lines.map((l) => ({
      ...newLine(), item_id: l.item_id, item_name: l.item_name, stock_in_item_id: l.stock_in_item_id ? String(l.stock_in_item_id) : '',
      in_qty: Number(l.in_qty) ? qtyText(l.in_qty) : '', in_price: qtyText(l.in_price),
      out_qty: Number(l.out_qty) ? qtyText(l.out_qty) : '', out_price: qtyText(l.out_price),
    }));
    setLines(ls.length ? ls : [newLine()]);
    ls.forEach((l) => loadInfo(l.key, l.item_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const addLineAfter = (key) => setLines((ls) => ls.flatMap((l) => (l.key === key ? [l, newLine()] : [l])));
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));

  /** current stock of the row's batch (or the item when no batch), its rate, and an Out over that stock */
  const view = (l) => {
    const batch = l.info?.batches.find((b) => String(b.stock_in_item_id) === l.stock_in_item_id);
    const cur = batch ? batch.left_qty : Number(l.info?.stock_qty || 0);
    const rate = Number(batch ? batch.rate : l.info?.purchase_rate || 0);
    const after = r2(cur + Number(l.in_qty || 0) - Number(l.out_qty || 0));
    return { cur, rate, after, bad: !!l.info && after < 0 };
  };
  const picked = lines.filter((l) => l.item_id);
  const totals = picked.reduce((s, l) => {
    const v = view(l);
    return {
      in: s.in + Number(l.in_qty || 0) * Number(l.in_price === '' ? v.rate : l.in_price),
      out: s.out + Number(l.out_qty || 0) * Number(l.out_price === '' ? v.rate : l.out_price),
    };
  }, { in: 0, out: 0 });
  const hasBad = picked.some((l) => view(l).bad);

  async function submit(e) {
    e.preventDefault();
    if (hasBad) { setError(t('adj.belowZero')); return; }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: picked.map(({ item_id, stock_in_item_id, in_qty, in_price, out_qty, out_price }) =>
        ({ item_id, stock_in_item_id: stock_in_item_id || null, in_qty, in_price, out_qty, out_price })),
    };
    try {
      const a = id ? await api(`/stock-adjustments/${id}`, { method: 'PUT', body }) : await api('/stock-adjustments', { method: 'POST', body });
      toast(t('adj.saved', { no: a.adj_no }));
      if (id) navigate('/stock-adjustments');
      else { setHead({ adj_date: todayLocal(), remarks: '' }); setLines([newLine()]); }
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
          <span className="compact-head-icon"><Icon name="box" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.adj_no}` : t('adj.new')}</h1>
            <p className="muted">{t('adj.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/stock-adjustments')}><Icon name="list" size={15} /> {t('adj.viewList')}</Button>
          </div>
        </div>
        <div className="form-grid si-head">
          <Input label={t('purchase.date')} type="date" required max={todayLocal()} value={head.adj_date}
            onChange={(e) => setHead((h) => ({ ...h, adj_date: e.target.value }))} />
          <TextArea label={t('adj.remarks')} full={false} rows={1} maxLength={300} value={head.remarks}
            onChange={(e) => setHead((h) => ({ ...h, remarks: e.target.value }))} />
        </div>

        <div className="table-wrap po-lines">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th className="po-item">{t('items.name')}</th>
                <th>{t('stockin.batch')}</th>
                <th className="num">{t('adj.curStock')}</th>
                <th className="num">{t('adj.inQty')}</th>
                <th className="num">{t('adj.inPrice')}</th>
                <th className="num">{t('adj.outQty')}</th>
                <th className="num">{t('adj.outPrice')}</th>
                <th className="num">{t('adj.after')}</th>
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {lines.map((l, n) => {
                const v = view(l);
                return (
                  <tr key={l.key}>
                    <td className="muted">{n + 1}</td>
                    <td className="po-item">
                      <ItemPicker browse value={l.item_name} ariaLabel={t('items.name')} placeholder={t('purchase.itemHint')}
                        onPick={({ item }) => {
                          if (!item) return;
                          setLine(l.key, { item_id: item.id, item_name: item.name, info: null, stock_in_item_id: '', in_price: '', out_price: '' });
                          loadInfo(l.key, item.id);
                        }} />
                    </td>
                    <td>
                      <select aria-label={t('stockin.batch')} disabled={!l.info} value={l.stock_in_item_id}
                        onChange={(e) => setLine(l.key, { stock_in_item_id: e.target.value, in_price: '', out_price: '' })}>
                        <option value="">{t('adj.noBatch')}</option>
                        {(l.info?.batches || []).map((b) => (
                          <option key={b.stock_in_item_id} value={String(b.stock_in_item_id)}>
                            {`${b.batch_no || '—'}${b.exp_date ? ` · ${month(b.exp_date)}` : ''} · ${qtyText(b.left_qty)}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{l.info ? qtyText(v.cur) : '—'}</td>
                    <td><input {...num} aria-label={t('adj.inQty')} value={l.in_qty} onChange={(e) => setLine(l.key, { in_qty: e.target.value })} /></td>
                    <td><input {...num} aria-label={t('adj.inPrice')} placeholder={l.info ? v.rate.toFixed(2) : ''} value={l.in_price} onChange={(e) => setLine(l.key, { in_price: e.target.value })} /></td>
                    <td className={v.bad ? 'cell-bad' : undefined}><input {...num} aria-label={t('adj.outQty')} value={l.out_qty} onChange={(e) => setLine(l.key, { out_qty: e.target.value })} /></td>
                    <td><input {...num} aria-label={t('adj.outPrice')} placeholder={l.info ? v.rate.toFixed(2) : ''} value={l.out_price} onChange={(e) => setLine(l.key, { out_price: e.target.value })} /></td>
                    <td className={`num${v.bad ? ' cell-bad' : ''}`}>{l.info ? qtyText(v.after) : '—'}</td>
                    <td>
                      <span className="po-row-actions">
                        <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')}
                          onClick={(e) => { addLineAfter(l.key); focusNewRow(e.currentTarget); }}>
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
                <td colSpan={5} className="num"><b>{t('adj.inTotal')}</b></td>
                <td className="num"><b>{money(totals.in)}</b></td>
                <td className="num"><b>{t('adj.outTotal')}</b></td>
                <td className="num"><b>{money(totals.out)}</b></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/stock-adjustments')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving}>{id ? t('common.save') : <><Icon name="box" size={16} /> {t('adj.save')}</>}</Button>
        </div>
      </Card>
    </form>
  );
}
