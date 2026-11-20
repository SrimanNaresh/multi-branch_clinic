// Pharmacy → Return → Sales Return: goods a customer brings back. Find the sale (sale no, customer or mobile),
// then enter how many of each item come back (in the unit it was sold by). Prices, Disc % and the sale's
// Bill Discount % come from the sale. Saving puts the stock back into the batch it was sold from.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove } from '../../lib/tableKeys.js';
import { Button, Card, ErrorBox, Input, Loading, Select, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { lineAmount, saleTotals } from '../../../../shared/sale.js';

const qtyText = (n) => String(Number(n || 0));
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export default function SalesReturnForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [saleId, setSaleId] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [find, setFind] = useState('');
  const [sale, setSale] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dFind = useDebounced(find);
  const existing = useAsync(() => (id ? api(`/sales-returns/${id}`) : Promise.resolve(null)), [id]);
  const sales = useAsync(() => (id ? Promise.resolve({ rows: [] }) : api('/sales-returns/sales', { query: { q: dFind } })), [dFind, id]);

  async function loadSale(sid, saved = []) {
    if (!sid) { setSale(null); setRows([]); return; }
    setRowsLoading(true);
    try {
      const s = await api(`/sales-returns/sale/${sid}`, { query: id ? { except: id } : {} });
      const bySaved = new Map(saved.map((l) => [l.sale_item_id, l]));
      setSale(s);
      setRows(s.lines.map((l) => ({ ...l, qty: bySaved.has(l.sale_item_id) ? qtyText(bySaved.get(l.sale_item_id).unit_qty) : '' })));
    } catch (err) {
      setError(err.message);
    } finally {
      setRowsLoading(false);
    }
  }

  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setSaleId(String(r.sale_id));
    setDate(String(r.return_date).slice(0, 10));
    loadSale(r.sale_id, r.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const setQty = (key, qty) => setRows((rs) => rs.map((r) => (r.sale_item_id === key ? { ...r, qty } : r)));
  const calc = (r) => ({ qty: Number(r.qty || 0), price: Number(r.price), disc_percent: Number(r.disc_percent) });
  const sums = saleTotals(rows.map(calc), sale?.disc_percent);
  const leftOf = (r) => r2(Number(r.sold) - Number(r.returned));
  const hasOver = rows.some((r) => Number(r.qty) > leftOf(r));

  async function submit(e) {
    e.preventDefault();
    if (!saleId) { setError(t('sret.chooseSale')); return; }
    if (hasOver) { setError(t('sale.fixRed')); return; }
    setSaving(true);
    setError('');
    const body = { sale_id: saleId, return_date: date, lines: rows.filter((r) => Number(r.qty) > 0).map((r) => ({ sale_item_id: r.sale_item_id, qty: r.qty })) };
    try {
      const ret = id ? await api(`/sales-returns/${id}`, { method: 'PUT', body }) : await api('/sales-returns', { method: 'POST', body });
      toast(t('sret.saved', { no: ret.return_no, amount: money(ret.total_amount) }));
      if (id) navigate('/sales-returns');
      else { setSaleId(''); setSale(null); setRows([]); setFind(''); setDate(todayLocal()); sales.reload(); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const saleOptions = (sales.data?.rows || []).map((s) => ({
    value: String(s.id), label: `${s.sale_no} · ${fmtDate(s.sale_date)} · ${s.customer_name}${s.mobile ? ` (${s.mobile})` : ''} · ${money(s.total_amount)}`,
  }));
  if (id && sale && !saleOptions.length) saleOptions.push({ value: String(sale.id), label: `${sale.sale_no} · ${fmtDate(sale.sale_date)} · ${sale.customer_name}` });
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="download" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.return_no}` : t('sret.new')}</h1>
            <p className="muted">{t('sret.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/sales-returns')}><Icon name="list" size={15} /> {t('sret.viewList')}</Button>
          </div>
        </div>

        <div className="form-grid si-head">
          {!id && <Input label={t('sret.findSale')} placeholder={t('sret.findHint')} value={find} onChange={(e) => setFind(e.target.value)} />}
          <Select label={t('sale.no')} required disabled={!!id} placeholder="—" value={saleId} options={saleOptions}
            onChange={(e) => { setSaleId(e.target.value); loadSale(e.target.value); }} />
          <Input label={t('purchase.date')} type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {sale && <p className="muted">{t('sret.saleInfo', { customer: sale.customer_name, mobile: sale.mobile || '—', date: fmtDate(sale.sale_date) })}</p>}

        {rowsLoading && <Loading />}
        {!rowsLoading && rows.length > 0 && (
          <div className="table-wrap po-lines si-lines">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="po-item">{t('items.name')}</th>
                  <th>{t('stockin.batch')}</th>
                  <th>{t('sale.sellBy')}</th>
                  <th className="num">{t('sale.price')}</th>
                  <th className="num">{t('purchase.disc')}</th>
                  <th className="num">{t('sret.sold')}</th>
                  <th className="num">{t('return.returned')}</th>
                  <th className="num">{t('sret.qty')}</th>
                  <th className="num">{t('purchase.amount')}</th>
                </tr>
              </thead>
              <tbody onKeyDown={arrowMove}>
                {rows.map((r, n) => {
                  const left = leftOf(r);
                  const over = Number(r.qty) > left;
                  return (
                    <tr key={r.sale_item_id}>
                      <td className="muted">{n + 1}</td>
                      <td className="po-item">{r.item_name}</td>
                      <td>{r.batch_no || '—'}</td>
                      <td>{r.sale_unit === 'unit' ? t('sale.unit') : t('sale.pack')}</td>
                      <td className="num">{money(r.price)}</td>
                      <td className="num">{Number(r.disc_percent) ? qtyText(r.disc_percent) : '—'}</td>
                      <td className="num">{qtyText(r.sold)}</td>
                      <td className="num">{qtyText(r.returned)}</td>
                      <td className={over ? 'si-over' : undefined} title={t('return.leftHint', { n: left })}>
                        <input {...num} max={left} aria-label={t('sret.qty')} disabled={left <= 0} value={r.qty}
                          onChange={(e) => setQty(r.sale_item_id, e.target.value)} />
                      </td>
                      <td className="num">{money(lineAmount(calc(r)))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} className="num"><b>{t('sale.subTotal')}</b></td>
                  <td className="num"><b>{money(sums.sub_total)}</b></td>
                </tr>
                {Number(sale?.disc_percent) > 0 && (
                  <tr>
                    <td colSpan={9} className="num">{t('sale.discountN', { n: qtyText(sale.disc_percent) })}</td>
                    <td className="num">− {money(sums.discount_amount)}</td>
                  </tr>
                )}
                <tr className="sale-total-row">
                  <td colSpan={9} className="num"><b>{t('sret.refund')}</b></td>
                  <td className="num po-sum">{money(sums.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/sales-returns')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving} disabled={!rows.length}>
            {id ? t('common.save') : <><Icon name="download" size={16} /> {t('sret.save')}</>}
          </Button>
        </div>
      </Card>
    </form>
  );
}
