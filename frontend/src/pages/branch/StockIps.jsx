// Pharmacy → Stock In → Three in One (IPS): Item, Purchase / Order and Stock In from one supplier bill.
// Type the bill's lines (pick an existing item, or type a new name and its details); the columns are grouped as
// on the Item, Purchase / Order and Stock In screens. Save All adds the new items, saves the order and the
// Stock In in one go (the server checks every row; if anything is wrong nothing is saved).
// Save Draft keeps the screen as it is (any time, rows may be incomplete) – Drafts (n) lists and reopens them.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove, focusNewRow } from '../../lib/tableKeys.js';
import { mmyyToMonth, typeMMYY } from '../../lib/months.js';
import { Button, Card, Empty, Input, Modal, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';
import { calcLine, roundOffOf } from '../../../../shared/purchase.js';
import { selAmount } from '../../../../shared/stockin.js';

let seq = 0;
const emptyRow = () => ({
  key: `r${++seq}`, item_id: null, name: '', generic_name: '', manufacturer: '', hsn_code: '', category: '', pack: '', unit: '',
  mrp: '', p_rate: '', disc_percent: '', qty: '', free_qty: '', gst: '', batch_no: '', mfg: '', exp: '', s_disc: '',
});
const fromItem = (i) => ({
  item_id: i.id, name: i.name, generic_name: i.generic_name || '', manufacturer: i.manufacturer || '', hsn_code: i.hsn_code || '',
  category: i.category || '', pack: i.pack || '', unit: i.unit || '', mrp: Number(i.mrp) || '', p_rate: Number(i.purchase_rate) || '',
  gst: Number(i.gst_percent) || (Number(i.cgst_percent) + Number(i.sgst_percent)) || '',
});
const EMPTY_HEAD = () => ({ supplier_id: '', date: todayLocal(), bill_no: '', round_off: false });
const two = (n) => Number(n || 0).toFixed(2);
const filled = (r) => r.item_id || r.name.trim();
const calcOf = (r) => calcLine({ p_rate: r.p_rate, disc_percent: r.disc_percent, qty: r.qty, cgst_percent: Number(r.gst || 0) / 2, sgst_percent: Number(r.gst || 0) / 2 });

/** What is wrong with a row (field → message), checked as the server will */
function rowProblems(r, thisMonth, t) {
  const p = {};
  if (!filled(r)) return p;
  if (!(Number(r.mrp) > 0)) p.mrp = t('ips.need');
  if (!(Number(r.p_rate) > 0)) p.p_rate = t('ips.need');
  else if (Number(r.mrp) > 0 && Number(r.p_rate) > Number(r.mrp)) p.p_rate = t('ips.overMrp');
  if (Number(r.disc_percent) > 100) p.disc_percent = '0–100';
  if (!(Number(r.qty) > 0) && !(Number(r.free_qty) > 0)) p.qty = t('ips.need');
  if (Number(r.gst) > 28) p.gst = '≤ 28';
  if (Number(r.s_disc) > 100) p.s_disc = '0–100';
  const mfg = mmyyToMonth(r.mfg);
  const exp = mmyyToMonth(r.exp);
  if (mfg === null) p.mfg = 'MM/YY';
  else if (mfg && mfg > thisMonth) p.mfg = t('ips.future');
  if (exp === null) p.exp = 'MM/YY';
  else if (exp && exp < thisMonth) p.exp = t('ips.past');
  else if (exp && mfg && exp <= mfg) p.exp = t('ips.afterMfg');
  return p;
}

export default function StockIps() {
  const { t } = useT();
  const toast = useToast();
  const [head, setHead] = useState(EMPTY_HEAD);
  const [rows, setRows] = useState([emptyRow()]);
  const [draftId, setDraftId] = useState(null);
  const [showItem, setShowItem] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const drafts = useAsync(() => api('/ips/drafts'), []);

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addAfter = (key) => setRows((rs) => rs.flatMap((r) => (r.key === key ? [r, emptyRow()] : [r])));
  const remove = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));

  const thisMonth = todayLocal().slice(0, 7);
  const used = rows.filter(filled);
  const problems = new Map(rows.map((r) => [r.key, rowProblems(r, thisMonth, t)]));
  const hasProblem = [...problems.values()].some((p) => Object.keys(p).length);
  const sum = Math.round(used.reduce((s, r) => s + calcOf(r).total, 0) * 100) / 100;
  const roundOff = head.round_off ? roundOffOf(sum) : 0;

  useEffect(() => { setDone(null); }, [head.supplier_id]);

  const screen = () => ({ head, rows: rows.map(({ key, ...r }) => r), showItem });
  async function saveDraft() {
    if (!head.supplier_id && !head.bill_no.trim()) { setError(t('ips.draftNeeds')); return; }
    setBusy('draft');
    setError('');
    try {
      const r = await api('/ips/drafts', { method: 'POST', body: {
        id: draftId, supplier_id: head.supplier_id || null, bill_no: head.bill_no, date: head.date,
        line_count: used.length, total: sum + roundOff, data: screen(),
      } });
      setDraftId(r.id);
      toast(r.warning ? `${t('ips.draftSaved')} – ${r.warning}` : t('ips.draftSaved'), r.warning ? 'error' : undefined);
      drafts.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function openDraft(id) {
    try {
      const d = await api(`/ips/drafts/${id}`);
      const data = d.data || {};
      setHead({ ...EMPTY_HEAD(), ...(data.head || {}) });
      setRows((data.rows || []).length ? data.rows.map((r) => ({ ...emptyRow(), ...r, key: emptyRow().key })) : [emptyRow()]);
      setShowItem(!!data.showItem);
      setDraftId(d.id);
      setShowDrafts(false);
      setError('');
      setDone(null);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteDraft(id) {
    if (!window.confirm(t('ips.deleteDraft'))) return;
    try {
      await api(`/ips/drafts/${id}`, { method: 'DELETE' });
      if (id === draftId) setDraftId(null);
      drafts.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveAll(e) {
    e.preventDefault();
    if (!head.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    if (!head.bill_no.trim()) { setError(t('ips.needBillNo')); return; }
    if (!used.length) { setError(t('ips.addItem')); return; }
    if (hasProblem) { setError(t('stockin.fixRed')); return; }
    setBusy('save');
    setError('');
    try {
      const r = await api('/ips/save', { method: 'POST', body: {
        ...head, draft_id: draftId,
        rows: used.map((r) => ({
          item_id: r.item_id, name: r.name, unit: r.unit, generic_name: r.generic_name, manufacturer: r.manufacturer,
          hsn_code: r.hsn_code, category: r.category, pack: r.pack, mrp: r.mrp, p_rate: r.p_rate, disc_percent: r.disc_percent,
          qty: r.qty, free_qty: r.free_qty, gst: r.gst, batch_no: r.batch_no, mfg: mmyyToMonth(r.mfg), exp: mmyyToMonth(r.exp), s_disc: r.s_disc,
        })),
      } });
      setDone(r);
      toast(t('ips.saved', { po: r.po_no, si: r.si_no }));
      setHead(EMPTY_HEAD());
      setRows([emptyRow()]);
      setDraftId(null);
      drafts.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };
  const cell = (r, field, input) => {
    const msg = problems.get(r.key)?.[field];
    return <td className={msg ? 'cell-bad' : undefined} title={msg}>{input}</td>;
  };
  const draftRows = drafts.data?.rows || [];

  return (
    <form onSubmit={saveAll}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="download" size={16} /></span>
          <div>
            <h1>{t('ips.title')}{draftId ? <small className="muted"> · {t('ips.draft')}</small> : null}</h1>
            <p className="muted">{t('ips.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowDrafts(true)}><Icon name="file" size={15} /> {t('ips.drafts', { n: draftRows.length })}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/stock-in')}><Icon name="list" size={15} /> {t('stockin.viewList')}</Button>
          </div>
        </div>

        <div className="form-grid si-head">
          <VendorPicker label={t('purchase.vendor')} required vendors={vendors.data?.rows || []} value={head.supplier_id}
            onPick={(v) => setHead((h) => ({ ...h, supplier_id: String(v.id) }))} />
          <Input label={t('pharma.billNo')} required maxLength={50} value={head.bill_no}
            onChange={(e) => setHead((h) => ({ ...h, bill_no: e.target.value.toUpperCase() }))} />
          <Input label={t('purchase.date')} type="date" required max={todayLocal()} value={head.date}
            onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} />
        </div>
        {done && (
          <div className="alert alert-info">
            {t('ips.doneMsg', { po: done.po_no, si: done.si_no, n: done.new_items, total: money(done.total) })}{' '}
            <Button type="button" size="sm" variant="ghost" onClick={() => navigate(`/stock-in/${done.stock_in_id}/edit`)}>{t('ips.openSi')}</Button>
          </div>
        )}

        <div className="table-wrap po-lines ips-lines">
          <table className="table">
            <thead>
              <tr className="ips-groups">
                <th />
                <th colSpan={showItem ? 7 : 2} className="ips-g-item">
                  <span className="po-item-head">
                    <span>{t('ips.gItem')}</span>
                    <button type="button" className={`po-more ${showItem ? 'open' : ''}`} aria-expanded={showItem}
                      title={showItem ? t('purchase.hideDetails') : t('purchase.showDetails')} onClick={() => setShowItem((s) => !s)}>
                      <Icon name={showItem ? 'chevronLeft' : 'chevronRight'} size={14} />
                    </button>
                  </span>
                </th>
                <th colSpan={8} className="ips-g-po">{t('ips.gPurchase')}</th>
                <th colSpan={5} className="ips-g-si">{t('ips.gStockIn')}</th>
                <th />
              </tr>
              <tr>
                <th>#</th>
                <th className="po-item">{t('items.name')}</th>
                {showItem && (
                  <>
                    <th>{t('items.generic')}</th>
                    <th>{t('items.manufacturer')}</th>
                    <th>HSN</th>
                    <th>{t('items.category')}</th>
                    <th>{t('items.pack')}</th>
                  </>
                )}
                <th>{t('purchase.unit')}</th>
                <th className="num">{t('items.mrp')}</th>
                <th className="num">{t('purchase.pRate')}</th>
                <th className="num">{t('purchase.disc')}</th>
                <th className="num">{t('items.quantity')}</th>
                <th className="num">{t('purchase.free')}</th>
                <th className="num">{t('purchase.gst')}</th>
                <th className="num">{t('purchase.rate')}</th>
                <th className="num">{t('purchase.total')}</th>
                <th>{t('stockin.batch')}</th>
                <th>{t('stockin.mfg')}</th>
                <th>{t('stockin.exp')}</th>
                <th className="num">{t('stockin.sDisc')}</th>
                <th className="num">{t('stockin.sel')}</th>
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {rows.map((r, n) => {
                const c = calcOf(r);
                return (
                  <tr key={r.key}>
                    <td className="muted">{n + 1}{r.name && !r.item_id && <small className="ips-new">{t('ips.newItem')}</small>}</td>
                    <td className="po-item">
                      <ItemPicker browse value={r.name} ariaLabel={t('items.name')} placeholder={t('ips.itemHint')}
                        onPick={({ item, medicine_name: typed }) => setRow(r.key, item ? fromItem(item) : { item_id: null, name: typed })} />
                    </td>
                    {showItem && ['generic_name', 'manufacturer', 'hsn_code', 'category', 'pack'].map((f) => (
                      <td key={f}><input aria-label={f} disabled={!!r.item_id} maxLength={f === 'hsn_code' ? 20 : 150} value={r[f]}
                        onChange={(e) => setRow(r.key, { [f]: e.target.value })} /></td>
                    ))}
                    <td><input aria-label={t('purchase.unit')} disabled={!!r.item_id} maxLength={30} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} /></td>
                    {cell(r, 'mrp', <input {...num} aria-label={t('items.mrp')} value={r.mrp} onChange={(e) => setRow(r.key, { mrp: e.target.value })} />)}
                    {cell(r, 'p_rate', <input {...num} aria-label={t('purchase.pRate')} value={r.p_rate} onChange={(e) => setRow(r.key, { p_rate: e.target.value })} />)}
                    {cell(r, 'disc_percent', <input {...num} max="100" aria-label={t('purchase.disc')} value={r.disc_percent} onChange={(e) => setRow(r.key, { disc_percent: e.target.value })} />)}
                    {cell(r, 'qty', <input {...num} aria-label={t('items.quantity')} value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />)}
                    <td><input {...num} aria-label={t('purchase.free')} value={r.free_qty} onChange={(e) => setRow(r.key, { free_qty: e.target.value })} /></td>
                    {cell(r, 'gst', <input {...num} max="28" aria-label={t('purchase.gst')} value={r.gst} onChange={(e) => setRow(r.key, { gst: e.target.value })} />)}
                    <td className="num">{filled(r) ? two(c.rate) : ''}</td>
                    <td className="num"><b>{filled(r) ? two(c.total) : ''}</b></td>
                    <td><input className="si-batch" aria-label={t('stockin.batch')} maxLength={50} value={r.batch_no} onChange={(e) => setRow(r.key, { batch_no: e.target.value })} /></td>
                    {cell(r, 'mfg', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.mfg')} value={r.mfg} onChange={(e) => setRow(r.key, { mfg: typeMMYY(e.target.value) })} />)}
                    {cell(r, 'exp', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.exp')} value={r.exp} onChange={(e) => setRow(r.key, { exp: typeMMYY(e.target.value) })} />)}
                    {cell(r, 's_disc', <input {...num} max="100" aria-label={t('stockin.sDisc')} value={r.s_disc} onChange={(e) => setRow(r.key, { s_disc: e.target.value })} />)}
                    <td className="num">{Number(r.mrp) > 0 ? two(selAmount({ mrp: r.mrp, disc_percent: r.s_disc })) : ''}</td>
                    <td>
                      <span className="po-row-actions">
                        <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')}
                          onClick={(e) => { addAfter(r.key); focusNewRow(e.currentTarget); }}><Icon name="plus" size={16} /></button>
                        <button type="button" className="icon-btn" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => remove(r.key)}>
                          <Icon name="trash" size={15} /></button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showItem ? 15 : 10} className="num"><b>{t('purchase.sumTotal')}</b></td>
                <td className="num"><b>{money(sum)}</b></td>
                <td colSpan={6} />
              </tr>
              <tr>
                <td colSpan={showItem ? 15 : 10} className="num">
                  <label className="round-off"><input type="checkbox" checked={head.round_off}
                    onChange={(e) => setHead((h) => ({ ...h, round_off: e.target.checked }))} /> <b>{t('pharma.roundOff')}</b></label>
                </td>
                <td className="num">{roundOff > 0 ? '+ ' : roundOff < 0 ? '− ' : ''}{money(Math.abs(roundOff))}</td>
                <td colSpan={6} />
              </tr>
              <tr className="sale-total-row">
                <td colSpan={showItem ? 15 : 10} className="num"><b>{t('pharma.netAmount')}</b></td>
                <td className="num po-sum">{money(sum + roundOff)}</td>
                <td colSpan={6} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted">{t('ips.formula')}</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          <Button type="button" variant="ghost" loading={busy === 'draft'} onClick={saveDraft}><Icon name="file" size={16} /> {t('ips.saveDraft')}</Button>
          <Button type="submit" loading={busy === 'save'}><Icon name="download" size={16} /> {t('ips.saveAll')}</Button>
        </div>
      </Card>

      {showDrafts && (
        <Modal title={t('ips.drafts', { n: draftRows.length })} onClose={() => setShowDrafts(false)} wide>
          {draftRows.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pharma.billNo')}</th><th>{t('purchase.vendor')}</th><th>{t('purchase.date')}</th>
                  <th className="num">{t('purchase.items')}</th><th className="num">{t('purchase.total')}</th><th>{t('ips.lastSaved')}</th><th />
                </tr>
              </thead>
              <tbody>
                {draftRows.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.bill_no || '—'}</b></td>
                    <td>{d.supplier_name || '—'}</td>
                    <td>{d.draft_date ? fmtDate(d.draft_date) : '—'}</td>
                    <td className="num">{d.line_count}</td>
                    <td className="num">{money(d.total)}</td>
                    <td className="muted">{fmtDate(d.updated_at, true)}</td>
                    <td className="col-actions">
                      <span className="row-actions">
                        <Button type="button" size="sm" onClick={() => openDraft(d.id)}>{t('ips.open')}</Button>
                        <Button type="button" size="sm" variant="ghost" className="btn-danger-ghost" onClick={() => deleteDraft(d.id)}><Icon name="trash" size={15} /></Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>{t('ips.noDrafts')}</Empty>}
        </Modal>
      )}
    </form>
  );
}

