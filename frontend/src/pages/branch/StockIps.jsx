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
import { mmyyToMonth, monthToMMYY, typeMMYY } from '../../lib/months.js';
import { buildIndex, matchName } from '../../lib/billScan.js';
import { packSizeOf } from '../../lib/billColumns.js';
import { Button, Card, Empty, Input, Modal, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';
import ScanBillModal from '../../components/ScanBillModal.jsx';
import { calcLine, discOf, linkPrice, roundOffOf } from '../../../../shared/purchase.js';
import { selAmount, unitPrice } from '../../../../shared/stockin.js';

let seq = 0;
const emptyRow = () => ({
  key: `r${++seq}`, item_id: null, name: '', generic_name: '', manufacturer: '', hsn_code: '', category: '', pack: '', unit: '', rack: '',
  mrp: '', p_rate: '', disc_percent: '', qty: '', free_qty: '', gst: '', batch_no: '', mfg: '', exp: '', s_disc: '',
});
const fromItem = (i) => ({
  item_id: i.id, name: i.name, generic_name: i.generic_name || '', manufacturer: i.manufacturer || '', hsn_code: i.hsn_code || '',
  category: i.category || '', pack: i.pack || '', unit: i.unit || '', rack: i.rack || '', mrp: Number(i.mrp) || '', p_rate: Number(i.purchase_rate) || '',
  disc_percent: Number(i.mrp) > 0 && Number(i.purchase_rate) > 0 ? discOf(i.mrp, i.purchase_rate) : '',
  gst: Number(i.gst_percent) || (Number(i.cgst_percent) + Number(i.sgst_percent)) || '',
});
const EMPTY_HEAD = () => ({ supplier_id: '', date: todayLocal(), bill_no: '', round_off: true });
const two = (n) => Number(n || 0).toFixed(2);
const filled = (r) => r.item_id || r.name.trim();
const calcOf = (r) => calcLine({ mrp: r.mrp, p_rate: r.p_rate, qty: r.qty, cgst_percent: Number(r.gst || 0) / 2, sgst_percent: Number(r.gst || 0) / 2 });

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
  // column groups that open / close with the › in their heading: Item details, Purchase extras, Stock In extras
  const [showItem, setShowItem] = useState(false);
  const [showPo, setShowPo] = useState(false);
  const [showSi, setShowSi] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const drafts = useAsync(() => api('/ips/drafts'), []);

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // MRP / Disc % / P.Rate typed: the other one is worked out (P.Rate = MRP less Disc %, shared/purchase.js)
  const setPrice = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? linkPrice(r, patch) : r)));
  // Disc % on all lines: for a supplier bill with one discount; every line's Disc % is set (each can still be
  // changed after); P.Rate = MRP less Disc %, so each Total and the Sum of Total come down
  const [allDisc, setAllDisc] = useState('');
  const discAllLines = (v) => { setAllDisc(v); setRows((rs) => rs.map((r) => linkPrice(r, { disc_percent: v }))); };
  const addAfter = (key) => setRows((rs) => rs.flatMap((r) => (r.key === key ? [r, emptyRow()] : [r])));
  const remove = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));

  const thisMonth = todayLocal().slice(0, 7);
  const used = rows.filter(filled);
  const problems = new Map(rows.map((r) => [r.key, rowProblems(r, thisMonth, t)]));
  // the Stock In extras open by themselves when one of their boxes has a problem, so nothing wrong is hidden
  const siOpen = showSi || [...problems.values()].some((p) => p.mfg || p.s_disc);
  // Old Price: this vendor's last P.Rate for each item already in the Item List (0 when never ordered from them)
  const oldIds = [...new Set(rows.filter((r) => r.item_id).map((r) => r.item_id))].sort((a, b) => a - b).join(',');
  const oldPrices = useAsync(
    () => (showPo && head.supplier_id && oldIds
      ? api('/purchases/old-prices', { query: { supplier_id: head.supplier_id, item_ids: oldIds } })
      : Promise.resolve({})),
    [showPo, head.supplier_id, oldIds],
  );
  const hasProblem = [...problems.values()].some((p) => Object.keys(p).length);
  const sum = Math.round(used.reduce((s, r) => s + calcOf(r).total, 0) * 100) / 100;
  const roundOff = head.round_off ? roundOffOf(sum) : 0;

  useEffect(() => { setDone(null); }, [head.supplier_id]);

  /**
   * Lines read from a scanned bill (Scan Bill → Fill the table) go under the rows already typed. A line whose name
   * is an item (same name, or very probably the same) uses that item; the bill's figures fill the rest:
   * P.Rate = the bill's rate (else MRP less its Disc %), GST % (else CGST + SGST), Batch No (else its Category),
   * Mf / Exp as MM/YY, S.Disc % (else from Sel.Amount). The bill date and supplier GSTIN fill the head.
   */
  async function addScanned(lines, header) {
    let index = [];
    try { index = buildIndex((await api('/ips/items')).rows); } catch { /* matched by hand then */ }
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v));
    const r2 = (n) => Math.round(n * 100) / 100;
    const scanned = lines.map((l) => {
      const m = matchName(l.name, index);
      const item = m.exact || m.likely;
      const mrp = num(l.mrp);
      const pRate = num(l.pRate) || (mrp && num(l.disc) ? r2(mrp * (1 - Number(l.disc) / 100)) : '');
      const gst = num(l.gst) || (num(l.cgst) || num(l.sgst) ? r2(Number(l.cgst || 0) + Number(l.sgst || 0)) : '');
      const sDisc = num(l.sDisc) !== '' ? num(l.sDisc) : (mrp && num(l.sel) ? r2((1 - Number(l.sel) / mrp) * 100) : '');
      const base = item ? fromItem(item) : {
        name: l.name, generic_name: l.generic || '', manufacturer: l.manufacturer || '', hsn_code: l.hsnCode || '',
        category: l.batch ? (l.category || '') : '', pack: l.pack || '', unit: l.unit || packSizeOf(l.pack), rack: l.rack || '',
      };
      return {
        ...emptyRow(), ...base,
        mrp: mrp || base.mrp || '', p_rate: pRate || base.p_rate || '',
        disc_percent: (mrp || base.mrp) > 0 && (pRate || base.p_rate) > 0 ? discOf(mrp || base.mrp, pRate || base.p_rate) : '',
        gst: gst || base.gst || '',
        qty: num(l.qty), free_qty: num(l.free),
        batch_no: l.batch || l.category || '', mfg: monthToMMYY(l.mfg), exp: monthToMMYY(l.exp),
        s_disc: sDisc > 0 && sDisc <= 100 ? sDisc : '',
      };
    });
    setRows((rs) => [...rs.filter(filled), ...scanned, emptyRow()]);
    if (scanned.some((r) => r.mfg || r.s_disc)) setShowSi(true);   // the bill filled Mf.Date / S.Disc %: show them
    if (scanned.some((r) => !r.item_id)) setShowItem(true);
    const gstNo = String(header?.gstNo || '').toUpperCase();
    const v = gstNo && (vendors.data?.rows || []).find((x) => String(x.gstin || '').toUpperCase() === gstNo);
    setHead((h) => ({
      ...h,
      supplier_id: h.supplier_id || (v ? String(v.id) : ''),
      date: header?.billDate && header.billDate <= todayLocal() ? header.billDate : h.date,
    }));
    toast(t('scan.added', { n: scanned.length }));
  }

  const screen = () => ({ head, rows: rows.map(({ key, ...r }) => r), showItem, showPo, showSi });
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
      setShowPo(!!data.showPo);
      setShowSi(!!data.showSi);
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
          hsn_code: r.hsn_code, category: r.category, pack: r.pack, rack: r.rack, mrp: r.mrp, p_rate: r.p_rate, disc_percent: r.disc_percent,
          qty: r.qty, free_qty: r.free_qty, gst: r.gst, batch_no: r.batch_no, mfg: mmyyToMonth(r.mfg), exp: mmyyToMonth(r.exp), s_disc: r.s_disc,
        })),
      } });
      setDone(r);
      toast(t('ips.saved', { po: r.po_no, si: r.si_no }));
      setHead(EMPTY_HEAD());
      setAllDisc('');
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
  const cell = (r, field, input, cls = '') => {
    const msg = problems.get(r.key)?.[field];
    return <td className={[cls, msg ? 'cell-bad' : ''].filter(Boolean).join(' ') || undefined} title={msg}>{input}</td>;
  };
  // footer: the columns before Total (# … GST %, with the open groups) and after it (Stock In + the + / bin column)
  const beforeTotal = 9 + (showItem ? 5 : 0) + (showPo ? 3 : 0);
  const afterTotal = (siOpen ? 6 : 3) + 1;
  // a group's heading: its name and the round › / ‹ that shows / hides its extra columns
  const groupHead = (label, open, setOpen, tone) => (
    <span className="po-item-head">
      <span>{label}</span>
      <button type="button" className={`po-more ips-more-${tone} ${open ? 'open' : ''}`} aria-expanded={open}
        title={open ? t('purchase.hideDetails') : t('purchase.showDetails')} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={14} />
      </button>
    </span>
  );
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowScan(true)}><Icon name="scan" size={15} /> {t('scan.title')}</Button>
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
            {/* fixed column shares (adding up to 100 %), so the table fits the screen with any group open or closed */}
            <colgroup>
              {(() => {
                const w = [
                  2.5, 12, ...(showItem ? [6.5, 8.5, 6, 6, 5] : []), 4,
                  5, ...(showPo ? [5] : []), 4.5, 5, 4.5, 4, ...(showPo ? [6] : []), 4, ...(showPo ? [5.5] : []), 6.5,
                  6.5, ...(siOpen ? [5.5] : []), 5.5, ...(siOpen ? [5] : []), 6, ...(siOpen ? [5.5] : []), 4,
                ];
                const total = w.reduce((a, x) => a + x, 0);
                return w.map((x, i) => <col key={i} style={{ width: `${(x / total) * 100}%` }} />);
              })()}
            </colgroup>
            <thead>
              <tr className="ips-groups">
                <th />
                <th colSpan={showItem ? 7 : 2} className="ips-g-item">{groupHead(t('ips.gItem'), showItem, setShowItem, 'item')}</th>
                <th colSpan={showPo ? 10 : 7} className="ips-g-po">{groupHead(t('ips.gPurchase'), showPo, setShowPo, 'po')}</th>
                <th colSpan={siOpen ? 6 : 3} className="ips-g-si">{groupHead(t('ips.gStockIn'), siOpen, setShowSi, 'si')}</th>
                <th />
              </tr>
              <tr>
                <th>#</th>
                <th className="po-item">{t('items.name')}</th>
                {showItem && (
                  <>
                    <th className="ips-x-item">{t('items.generic')}</th>
                    <th className="ips-x-item">{t('items.manufacturer')}</th>
                    <th className="ips-x-item">HSN</th>
                    <th className="ips-x-item">{t('items.category')}</th>
                    <th className="ips-x-item">{t('items.pack')}</th>
                  </>
                )}
                <th>{t('purchase.unit')}</th>
                <th className="num">{t('items.mrp')}</th>
                {showPo && <th className="num ips-x-po">{t('purchase.oldPrice')}</th>}
                <th className="num">{t('purchase.disc')}</th>
                <th className="num">{t('purchase.pRate')}</th>
                <th className="num">{t('items.quantity')}</th>
                <th className="num">{t('purchase.free')}</th>
                {showPo && <th className="num ips-x-po">{t('purchase.amount')}</th>}
                <th className="num">{t('purchase.gst')}</th>
                {showPo && <th className="num ips-x-po">{t('purchase.gstAmount')}</th>}
                <th className="num">{t('purchase.total')}</th>
                <th>{t('stockin.batch')}</th>
                {siOpen && <th className="ips-x-si">{t('stockin.mfg')}</th>}
                <th>{t('stockin.exp')}</th>
                {siOpen && <th className="num ips-x-si">{t('stockin.sDisc')}</th>}
                <th className="num">{t('stockin.sel')}</th>
                {siOpen && <th className="num ips-x-si">{t('stockin.unitPrice')}</th>}
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {rows.map((r, n) => {
                const c = calcOf(r);
                const sel = Number(r.mrp) > 0 ? selAmount({ mrp: r.mrp, disc_percent: r.s_disc }) : null;
                const old = r.item_id && head.supplier_id ? Number(oldPrices.data?.[r.item_id] || 0) : null;
                return (
                  <tr key={r.key}>
                    <td className="muted">{n + 1}{r.name && !r.item_id && <small className="ips-new">{t('ips.newItem')}</small>}</td>
                    <td className="po-item">
                      <ItemPicker browse value={r.name} ariaLabel={t('items.name')} placeholder={t('ips.itemHint')}
                        onPick={({ item, medicine_name: typed }) => setRow(r.key, item ? fromItem(item) : { item_id: null, name: typed })} />
                    </td>
                    {showItem && ['generic_name', 'manufacturer', 'hsn_code', 'category', 'pack'].map((f) => (
                      <td key={f} className="ips-x-item"><input aria-label={f} disabled={!!r.item_id} maxLength={f === 'hsn_code' ? 20 : 150} value={r[f]}
                        onChange={(e) => setRow(r.key, { [f]: e.target.value })} /></td>
                    ))}
                    <td><input aria-label={t('purchase.unit')} disabled={!!r.item_id} maxLength={30} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} /></td>
                    {cell(r, 'mrp', <input {...num} aria-label={t('items.mrp')} value={r.mrp} onChange={(e) => setPrice(r.key, { mrp: e.target.value })} />)}
                    {showPo && <td className="num muted ips-x-po">{old == null ? '—' : two(old)}</td>}
                    {cell(r, 'disc_percent', <input {...num} max="100" aria-label={t('purchase.disc')} value={r.disc_percent} onChange={(e) => setPrice(r.key, { disc_percent: e.target.value })} />)}
                    {cell(r, 'p_rate', <input {...num} aria-label={t('purchase.pRate')} value={r.p_rate} onChange={(e) => setPrice(r.key, { p_rate: e.target.value })} />)}
                    {cell(r, 'qty', <input {...num} aria-label={t('items.quantity')} value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />)}
                    <td><input {...num} aria-label={t('purchase.free')} value={r.free_qty} onChange={(e) => setRow(r.key, { free_qty: e.target.value })} /></td>
                    {showPo && <td className="num ips-x-po">{filled(r) ? two(c.amount) : ''}</td>}
                    {cell(r, 'gst', <input {...num} max="28" aria-label={t('purchase.gst')} value={r.gst} onChange={(e) => setRow(r.key, { gst: e.target.value })} />)}
                    {showPo && <td className="num ips-x-po">{filled(r) ? two(c.gst_amount) : ''}</td>}
                    <td className="num"><b>{filled(r) ? two(c.total) : ''}</b></td>
                    <td><input className="si-batch" aria-label={t('stockin.batch')} maxLength={50} value={r.batch_no} onChange={(e) => setRow(r.key, { batch_no: e.target.value })} /></td>
                    {siOpen && cell(r, 'mfg', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.mfg')} value={r.mfg} onChange={(e) => setRow(r.key, { mfg: typeMMYY(e.target.value) })} />, 'ips-x-si')}
                    {cell(r, 'exp', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.exp')} value={r.exp} onChange={(e) => setRow(r.key, { exp: typeMMYY(e.target.value) })} />)}
                    {siOpen && cell(r, 's_disc', <input {...num} max="100" aria-label={t('stockin.sDisc')} value={r.s_disc} onChange={(e) => setRow(r.key, { s_disc: e.target.value })} />, 'ips-x-si')}
                    <td className="num">{sel != null ? two(sel) : ''}</td>
                    {siOpen && <td className="num ips-x-si">{sel != null ? two(unitPrice(sel, r.unit)) : ''}</td>}
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
              <tr className="no-print">
                <td colSpan={beforeTotal} className="num">
                  <label className="ips-disc-all">{t('ips.discAll')}{' '}
                    <input type="number" min="0" max="100" step="0.01" aria-label={t('ips.discAll')}
                      value={allDisc} onChange={(e) => discAllLines(e.target.value)} />
                  </label>
                </td>
                <td colSpan={afterTotal + 1} className="muted">{t('ips.discAllHint')}</td>
              </tr>
              <tr>
                <td colSpan={beforeTotal} className="num"><b>{t('purchase.sumTotal')}</b></td>
                <td className="num"><b>{money(sum)}</b></td>
                <td colSpan={afterTotal} />
              </tr>
              <tr>
                <td colSpan={beforeTotal} className="num">
                  <label className="round-off"><input type="checkbox" checked={head.round_off}
                    onChange={(e) => setHead((h) => ({ ...h, round_off: e.target.checked }))} /> <b>{t('pharma.roundOff')}</b></label>
                </td>
                <td className="num">{roundOff > 0 ? '+ ' : roundOff < 0 ? '− ' : ''}{money(Math.abs(roundOff))}</td>
                <td colSpan={afterTotal} />
              </tr>
              <tr className="sale-total-row">
                <td colSpan={beforeTotal} className="num"><b>{t('pharma.netAmount')}</b></td>
                <td className="num po-sum">{money(sum + roundOff)}</td>
                <td colSpan={afterTotal} />
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

      {showScan && <ScanBillModal onClose={() => setShowScan(false)} onLines={addScanned} />}
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

