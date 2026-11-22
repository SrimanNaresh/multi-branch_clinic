// Pharmacy → Stock In → Three in One (IPS): Item, Purchase / Order and Stock In from one supplier bill.
// Type the bill's lines (pick an existing item, or type a new name and its details); the columns are grouped as
// on the Item, Purchase / Order and Stock In screens. Save All adds the new items, saves the order and the
// Stock In in one go (the server checks every row; if anything is wrong nothing is saved).
// Save Draft keeps the screen as it is (any time, rows may be incomplete) – Drafts (n) lists and reopens them.
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { arrowMove, focusNewRow } from '../../lib/tableKeys.js';
import { mmyyToMonth, monthToMMYY, typeMMYY } from '../../lib/months.js';
import { buildIndex, matchName } from '../../lib/billScan.js';
import { packSizeOf } from '../../lib/billColumns.js';
import { useGridColumns } from '../../lib/gridColumns.js';
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

// The grid's columns: width share, group (Item / Purchase / Stock In), extra = hidden until the group's › or the
// Columns list shows it, fixed = always shown, problem = the row check that forces the column into view
const COL_SPEC = [
  { key: 'no', w: 2.5, fixed: true },
  { key: 'name', w: 12, group: 'item', fixed: true },
  { key: 'generic_name', w: 6.5, group: 'item', extra: true },
  { key: 'manufacturer', w: 8.5, group: 'item', extra: true },
  { key: 'hsn_code', w: 6, group: 'item', extra: true },
  { key: 'category', w: 6, group: 'item', extra: true },
  { key: 'pack', w: 5, group: 'item', extra: true },
  { key: 'unit', w: 4, group: 'item' },
  { key: 'mrp', w: 5, group: 'po', problem: 'mrp' },
  { key: 'old', w: 5, group: 'po', extra: true },
  { key: 'disc_percent', w: 4.5, group: 'po', problem: 'disc_percent' },
  { key: 'p_rate', w: 5, group: 'po', problem: 'p_rate' },
  { key: 'qty', w: 4.5, group: 'po', problem: 'qty' },
  { key: 'free_qty', w: 4, group: 'po' },
  { key: 'amount', w: 6, group: 'po', extra: true },
  { key: 'gst', w: 4, group: 'po', problem: 'gst' },
  { key: 'gst_amount', w: 5.5, group: 'po', extra: true },
  { key: 'total', w: 6.5, group: 'po', fixed: true },
  { key: 'batch_no', w: 6.5, group: 'si' },
  { key: 'mfg', w: 5.5, group: 'si', extra: true, problem: 'mfg' },
  { key: 'exp', w: 5.5, group: 'si', problem: 'exp' },
  { key: 's_disc', w: 5, group: 'si', extra: true, problem: 's_disc' },
  { key: 'sel', w: 6, group: 'si' },
  { key: 'unit_price', w: 5.5, group: 'si', extra: true },
  { key: 'actions', w: 4, fixed: true },
];
const NUM_COLS = new Set(['mrp', 'old', 'disc_percent', 'p_rate', 'qty', 'free_qty', 'amount', 'gst', 'gst_amount', 'total', 's_disc', 'sel', 'unit_price']);
const GROUPS = [['item', 'ips.gItem'], ['po', 'ips.gPurchase'], ['si', 'ips.gStockIn']];
const xCls = (c) => (c.extra ? `ips-x-${c.group}` : '');

export default function StockIps() {
  const { t } = useT();
  const toast = useToast();
  const [head, setHead] = useState(EMPTY_HEAD);
  const [rows, setRows] = useState([emptyRow()]);
  const [draftId, setDraftId] = useState(null);
  // which columns are shown and their widths (kept on this PC): group ›, Columns list, drag a heading's edge
  const gc = useGridColumns('sc_ips_cols', COL_SPEC);
  const tableRef = useRef(null);
  const [colsOpen, setColsOpen] = useState(false);
  const colsBox = useRef(null);
  useEffect(() => {
    if (!colsOpen) return undefined;
    const close = (e) => { if (!colsBox.current?.contains(e.target)) setColsOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setColsOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [colsOpen]);
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
  // shown columns: fixed ones, the ones not hidden, and any hidden one with a problem in a row (nothing wrong is hidden)
  const forced = new Set(COL_SPEC.filter((c) => c.problem && [...problems.values()].some((p) => p[c.problem])).map((c) => c.key));
  const visible = COL_SPEC.filter((c) => c.fixed || forced.has(c.key) || !gc.isHidden(c.key));
  const shown = (key) => visible.some((c) => c.key === key);
  // Old Price: this vendor's last P.Rate for each item already in the Item List (0 when never ordered from them)
  const oldIds = [...new Set(rows.filter((r) => r.item_id).map((r) => r.item_id))].sort((a, b) => a - b).join(',');
  const oldPrices = useAsync(
    () => (shown('old') && head.supplier_id && oldIds
      ? api('/purchases/old-prices', { query: { supplier_id: head.supplier_id, item_ids: oldIds } })
      : Promise.resolve({})),
    [shown('old'), head.supplier_id, oldIds],
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
    if (scanned.some((r) => r.mfg || r.s_disc)) gc.showCols(['mfg', 's_disc'], true);   // the bill filled them: show them
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

  const screen = () => ({ head, rows: rows.map(({ key, ...r }) => r) });
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
  // footer: the columns before Total and after it (Stock In + the + / bin column)
  const beforeTotal = visible.findIndex((c) => c.key === 'total');
  const afterTotal = visible.length - beforeTotal - 1;
  // the group heading row: one cell per run of shown columns of the same group
  const groupSpans = visible.reduce((acc, c) => {
    const last = acc[acc.length - 1];
    if (c.group && last?.group === c.group) last.span += 1; else acc.push({ group: c.group || null, span: 1 });
    return acc;
  }, []);
  // a group's heading: its name and the round › / ‹ that shows / hides its extra columns
  const groupHead = (group) => {
    const open = gc.groupOpen(group);
    return (
      <span className="po-item-head">
        <span>{t(GROUPS.find(([g]) => g === group)[1])}</span>
        <button type="button" className={`po-more ips-more-${group} ${open ? 'open' : ''}`} aria-expanded={open}
          title={open ? t('purchase.hideDetails') : t('purchase.showDetails')} onClick={() => gc.toggleGroup(group)}>
          <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={14} />
        </button>
      </span>
    );
  };
  const colLabel = {
    no: '#', name: t('items.name'), generic_name: t('items.generic'), manufacturer: t('items.manufacturer'), hsn_code: 'HSN',
    category: t('items.category'), pack: t('items.pack'), unit: t('purchase.unit'), mrp: t('items.mrp'), old: t('purchase.oldPrice'),
    disc_percent: t('purchase.disc'), p_rate: t('purchase.pRate'), qty: t('items.quantity'), free_qty: t('purchase.free'),
    amount: t('purchase.amount'), gst: t('purchase.gst'), gst_amount: t('purchase.gstAmount'), total: t('purchase.total'),
    batch_no: t('stockin.batch'), mfg: t('stockin.mfg'), exp: t('stockin.exp'), s_disc: t('stockin.sDisc'), sel: t('stockin.sel'),
    unit_price: t('stockin.unitPrice'), actions: '',
  };
  /** One cell of a row (x = the row's worked-out sums: c, sel, old) */
  function renderCell(col, r, n, x) {
    const cls = xCls(col);
    switch (col.key) {
      case 'no': return <td className="muted">{n + 1}{r.name && !r.item_id && <small className="ips-new">{t('ips.newItem')}</small>}</td>;
      case 'name': return (
        <td className="po-item">
          <ItemPicker browse value={r.name} ariaLabel={t('items.name')} placeholder={t('ips.itemHint')}
            onPick={({ item, medicine_name: typed }) => setRow(r.key, item ? fromItem(item) : { item_id: null, name: typed })} />
        </td>
      );
      case 'generic_name': case 'manufacturer': case 'hsn_code': case 'category': case 'pack': return (
        <td className={cls}><input aria-label={colLabel[col.key]} disabled={!!r.item_id} maxLength={col.key === 'hsn_code' ? 20 : 150}
          value={r[col.key]} onChange={(e) => setRow(r.key, { [col.key]: e.target.value })} /></td>
      );
      case 'unit': return <td><input aria-label={t('purchase.unit')} disabled={!!r.item_id} maxLength={30} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} /></td>;
      case 'mrp': return cell(r, 'mrp', <input {...num} aria-label={t('items.mrp')} value={r.mrp} onChange={(e) => setPrice(r.key, { mrp: e.target.value })} />);
      case 'old': return <td className={`num muted ${cls}`}>{x.old == null ? '—' : two(x.old)}</td>;
      case 'disc_percent': return cell(r, 'disc_percent', <input {...num} max="100" aria-label={t('purchase.disc')} value={r.disc_percent} onChange={(e) => setPrice(r.key, { disc_percent: e.target.value })} />);
      case 'p_rate': return cell(r, 'p_rate', <input {...num} aria-label={t('purchase.pRate')} value={r.p_rate} onChange={(e) => setPrice(r.key, { p_rate: e.target.value })} />);
      case 'qty': return cell(r, 'qty', <input {...num} aria-label={t('items.quantity')} value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />);
      case 'free_qty': return <td><input {...num} aria-label={t('purchase.free')} value={r.free_qty} onChange={(e) => setRow(r.key, { free_qty: e.target.value })} /></td>;
      case 'amount': return <td className={`num ${cls}`}>{filled(r) ? two(x.c.amount) : ''}</td>;
      case 'gst': return cell(r, 'gst', <input {...num} max="28" aria-label={t('purchase.gst')} value={r.gst} onChange={(e) => setRow(r.key, { gst: e.target.value })} />);
      case 'gst_amount': return <td className={`num ${cls}`}>{filled(r) ? two(x.c.gst_amount) : ''}</td>;
      case 'total': return <td className="num"><b>{filled(r) ? two(x.c.total) : ''}</b></td>;
      case 'batch_no': return <td><input className="si-batch" aria-label={t('stockin.batch')} maxLength={50} value={r.batch_no} onChange={(e) => setRow(r.key, { batch_no: e.target.value })} /></td>;
      case 'mfg': return cell(r, 'mfg', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.mfg')} value={r.mfg} onChange={(e) => setRow(r.key, { mfg: typeMMYY(e.target.value) })} />, cls);
      case 'exp': return cell(r, 'exp', <input className="si-month" inputMode="numeric" placeholder="MM/YY" aria-label={t('stockin.exp')} value={r.exp} onChange={(e) => setRow(r.key, { exp: typeMMYY(e.target.value) })} />);
      case 's_disc': return cell(r, 's_disc', <input {...num} max="100" aria-label={t('stockin.sDisc')} value={r.s_disc} onChange={(e) => setRow(r.key, { s_disc: e.target.value })} />, cls);
      case 'sel': return <td className="num">{x.sel != null ? two(x.sel) : ''}</td>;
      case 'unit_price': return <td className={`num ${cls}`}>{x.sel != null ? two(unitPrice(x.sel, r.unit)) : ''}</td>;
      case 'actions': return (
        <td>
          <span className="po-row-actions">
            <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')}
              onClick={(e) => { addAfter(r.key); focusNewRow(e.currentTarget); }}><Icon name="plus" size={16} /></button>
            <button type="button" className="icon-btn" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => remove(r.key)}>
              <Icon name="trash" size={15} /></button>
          </span>
        </td>
      );
      default: return <td />;
    }
  }
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
            <span className="ips-cols" ref={colsBox}>
              <Button type="button" variant="ghost" size="sm" className={colsOpen ? 'on' : ''} aria-expanded={colsOpen} onClick={() => setColsOpen((o) => !o)}>
                <Icon name="grip" size={15} /> {t('ips.columns')}
              </Button>
              {colsOpen && (
                <div className="ips-cols-menu" role="dialog" aria-label={t('ips.columns')}>
                  <p className="muted">{t('ips.columnsHint')}</p>
                  <div className="ips-cols-groups">
                    {GROUPS.map(([g, label]) => (
                      <div key={g} className={`ips-cols-group ips-cols-g-${g}`}>
                        <b>{t(label)}</b>
                        {COL_SPEC.filter((c) => c.group === g && !c.fixed).map((c) => (
                          <label key={c.key} className="ips-cols-item">
                            <input type="checkbox" checked={!gc.isHidden(c.key)} onChange={() => gc.toggle(c.key)} /> {colLabel[c.key]}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="ips-cols-actions">
                    <Button type="button" size="sm" variant="ghost" onClick={gc.resetColumns}>{t('ips.defaultCols')}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={gc.resetWidths}>{t('ips.resetWidths')}</Button>
                  </div>
                </div>
              )}
            </span>
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
          <table className="table" ref={tableRef}>
            {/* column shares (adding up to 100 %): the table fits the screen; a widened column takes room from the others */}
            <colgroup>
              {(() => {
                const total = visible.reduce((a, c) => a + gc.widthOf(c), 0);
                return visible.map((c) => <col key={c.key} style={{ width: `${(gc.widthOf(c) / total) * 100}%` }} />);
              })()}
            </colgroup>
            <thead>
              <tr className="ips-groups">
                {groupSpans.map((g, i) => (g.group
                  ? <th key={g.group} colSpan={g.span} className={`ips-g-${g.group}`}>{groupHead(g.group)}</th>
                  : <th key={`blank-${i}`} />))}
              </tr>
              <tr>
                {visible.map((c) => (
                  <th key={c.key} className={[NUM_COLS.has(c.key) ? 'num' : '', c.key === 'name' ? 'po-item' : '', xCls(c)].filter(Boolean).join(' ') || undefined}>
                    {colLabel[c.key]}
                    {c.key !== 'actions' && (
                      <span className="col-resize" title={t('ips.dragWiden')} aria-hidden="true"
                        onPointerDown={(e) => gc.startResize(e, c.key, visible, tableRef.current)} onDoubleClick={() => gc.resetWidth(c.key)} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {rows.map((r, n) => {
                const x = {
                  c: calcOf(r),
                  sel: Number(r.mrp) > 0 ? selAmount({ mrp: r.mrp, disc_percent: r.s_disc }) : null,
                  old: r.item_id && head.supplier_id ? Number(oldPrices.data?.[r.item_id] || 0) : null,
                };
                return (
                  <tr key={r.key}>
                    {visible.map((c) => <Fragment key={c.key}>{renderCell(c, r, n, x)}</Fragment>)}
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
                {afterTotal > 0 && <td colSpan={afterTotal} />}
              </tr>
              <tr>
                <td colSpan={beforeTotal} className="num">
                  <label className="round-off"><input type="checkbox" checked={head.round_off}
                    onChange={(e) => setHead((h) => ({ ...h, round_off: e.target.checked }))} /> <b>{t('pharma.roundOff')}</b></label>
                </td>
                <td className="num">{roundOff > 0 ? '+ ' : roundOff < 0 ? '− ' : ''}{money(Math.abs(roundOff))}</td>
                {afterTotal > 0 && <td colSpan={afterTotal} />}
              </tr>
              <tr className="sale-total-row">
                <td colSpan={beforeTotal} className="num"><b>{t('pharma.netAmount')}</b></td>
                <td className="num po-sum">{money(sum + roundOff)}</td>
                {afterTotal > 0 && <td colSpan={afterTotal} />}
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

