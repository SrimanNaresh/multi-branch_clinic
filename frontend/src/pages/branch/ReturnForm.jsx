// Pharmacy → Return → Master: goods sent back to the vendor. Pick the vendor, then one of its Stock Ins –
// its items and batches are listed with what was received and already returned; enter the quantity to
// send back. Saving takes those quantities out of stock.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove } from '../../lib/tableKeys.js';
import { Button, Card, ErrorBox, Input, Loading, Select, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';

const qtyText = (n) => String(Number(n || 0));
const r2 = (n) => Math.round(n * 100) / 100;
const month = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—');

export default function ReturnForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState({ supplier_id: '', stock_in_id: '', return_date: todayLocal() });
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/returns/${id}`) : Promise.resolve(null)), [id]);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const stockIns = useAsync(
    () => (head.supplier_id ? api('/stock-in', { query: { supplier_id: head.supplier_id, limit: 100 } }) : Promise.resolve({ rows: [] })),
    [head.supplier_id],
  );

  // the chosen Stock In's items and batches (editing: with this Return's quantities)
  async function loadRows(siId, saved = []) {
    if (!siId) { setRows([]); return; }
    setRowsLoading(true);
    try {
      const r = await api(`/returns/stock-in/${siId}`, { query: id ? { except: id } : {} });
      const bySaved = new Map(saved.map((s) => [s.stock_in_item_id, s]));
      setRows(r.rows.map((l) => ({ ...l, rate: Number(l.rate), qty: bySaved.has(l.stock_in_item_id) ? qtyText(bySaved.get(l.stock_in_item_id).qty) : '' })));
    } catch (err) {
      setError(err.message);
    } finally {
      setRowsLoading(false);
    }
  }

  useEffect(() => {
    const ret = existing.data;
    if (!ret) return;
    setHead({ supplier_id: String(ret.supplier_id), stock_in_id: String(ret.stock_in_id), return_date: String(ret.return_date).slice(0, 10) });
    loadRows(ret.stock_in_id, ret.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.stock_in_item_id === key ? { ...r, ...patch } : r)));
  const total = r2(rows.reduce((s, r) => s + r2(Number(r.qty || 0) * r.rate), 0));
  const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);

  async function submit(e) {
    e.preventDefault();
    if (!head.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    if (!head.stock_in_id) { setError(t('return.chooseStockIn')); return; }
    setSaving(true);
    setError('');
    const body = { ...head, lines: rows.filter((r) => Number(r.qty) > 0).map(({ stock_in_item_id, qty }) => ({ stock_in_item_id, qty })) };
    try {
      const ret = id ? await api(`/returns/${id}`, { method: 'PUT', body }) : await api('/returns', { method: 'POST', body });
      toast(t('return.saved', { no: ret.return_no }));
      if (id) navigate('/returns');
      else { setHead({ supplier_id: '', stock_in_id: '', return_date: todayLocal() }); setRows([]); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const stockInOptions = (stockIns.data?.rows || []).map((s) => ({
    value: String(s.id), label: `${s.si_no} · ${fmtDate(s.si_date)} · ${s.po_no}`,
  }));

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="upload" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.return_no}` : t('return.new')}</h1>
            <p className="muted">{t('return.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/returns')}><Icon name="list" size={15} /> {t('return.viewList')}</Button>
          </div>
        </div>

        <div className="form-grid si-head">
          <VendorPicker label={t('purchase.vendor')} required vendors={vendors.data?.rows || []} value={head.supplier_id}
            onPick={(v) => { setHead((h) => ({ ...h, supplier_id: String(v.id), stock_in_id: '' })); setRows([]); }} />
          <Select label={t('stockin.no')} required placeholder={head.supplier_id ? '—' : t('stockin.vendorFirst')}
            disabled={!head.supplier_id} value={head.stock_in_id} options={stockInOptions}
            onChange={(e) => { setHead((h) => ({ ...h, stock_in_id: e.target.value })); loadRows(e.target.value); }} />
          <Input label={t('purchase.date')} type="date" required value={head.return_date}
            onChange={(e) => setHead((h) => ({ ...h, return_date: e.target.value }))} />
        </div>
        {head.supplier_id && !stockIns.loading && !stockInOptions.length && <p className="muted">{t('return.noStockIns')}</p>}

        {rowsLoading && <Loading />}
        {!rowsLoading && rows.length > 0 && (
          <div className="table-wrap po-lines si-lines">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="po-item">{t('items.name')}</th>
                  <th>{t('stockin.batch')}</th>
                  <th>{t('stockin.mfg')}</th>
                  <th>{t('stockin.exp')}</th>
                  <th className="num">{t('purchase.rate')}</th>
                  <th className="num">{t('stockin.received')}</th>
                  <th className="num">{t('return.returned')}</th>
                  <th className="num">{t('return.qty')}</th>
                  <th className="num">{t('purchase.amount')}</th>
                </tr>
              </thead>
              <tbody onKeyDown={arrowMove}>
                {rows.map((r, n) => {
                  const left = r2(Number(r.received) - Number(r.returned));
                  const over = Number(r.qty) > left;
                  return (
                    <tr key={r.stock_in_item_id}>
                      <td className="muted">{n + 1}</td>
                      <td className="po-item">{r.item_name}</td>
                      <td>{r.batch_no || '—'}</td>
                      <td>{month(r.mfg_date)}</td>
                      <td>{month(r.exp_date)}</td>
                      <td className="num">{r.rate.toFixed(2)}</td>
                      <td className="num">{qtyText(r.received)}</td>
                      <td className="num">{qtyText(r.returned)}</td>
                      <td className={over ? 'si-over' : undefined} title={t('return.leftHint', { n: left })}>
                        <input type="number" min="0" max={left} step="0.01" inputMode="decimal" aria-label={t('return.qty')}
                          disabled={left <= 0} value={r.qty} onChange={(e) => setRow(r.stock_in_item_id, { qty: e.target.value })} />
                      </td>
                      <td className="num">{r2(Number(r.qty || 0) * r.rate).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="num"><b>{t('purchase.sumTotal')}</b></td>
                  <td className="num"><b>{qtyText(totalQty)}</b></td>
                  <td className="num po-sum">{money(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/returns')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving} disabled={!rows.length}>
            {id ? t('common.save') : <><Icon name="upload" size={16} /> {t('return.save')}</>}
          </Button>
        </div>
      </Card>
    </form>
  );
}
