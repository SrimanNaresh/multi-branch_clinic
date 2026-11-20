// Stock In → Three in One → Scan Bill (same steps as Ayush All In One):
//  1. Upload  – a photo (JPG / PNG) or a PDF of the supplier's bill; each page is turned upright.
//  2. Select table – drag a box around the item table, header row included (zoom, move, turn, pages);
//     or read the whole page. Only that part is read (OCR in the browser).
//  3. Match columns – the bill's table as read; drag a tile (Item Name, MRP, Qty, Batch No …) onto each bill
//     column (or tap the tile, then the column). Tiles that clearly match are placed already.
//  4. Fill the table – the lines go to the Three in One table (onLines) for checking; nothing is saved here.
// The column / value helpers below come from All In One's ScanBillModal (IPS columns only).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n.jsx';
import { compact, extractBillHeader, extractBillRows, extractBillTable, extractItems } from '../lib/billScan.js';
import { Button, Modal } from './ui.jsx';
import Icon from './Icon.jsx';

// The Three in One columns as tiles: [key, heading], grouped Item · Purchase / Order · Stock In.
const TARGETS = [
  ['name', 'Item Name'], ['generic', 'Generic'], ['manufacturer', 'Manufacturer'], ['hsnCode', 'HSN'],
  ['category', 'Category'], ['pack', 'Pack'], ['unit', 'Unit'],
  ['mrp', 'MRP'], ['oldPrice', 'Old Price'], ['disc', 'Disc%'], ['pRate', 'P.Rate'],
  ['qty', 'Qty'], ['free', 'Free'], ['amount', 'Amount'],
  ['gst', 'GST%'], ['cgst', 'CGST%'], ['sgst', 'SGST%'], ['gstAmt', 'GST Amt'], ['total', 'Total'],
  ['batch', 'Batch No'], ['mfg', 'Mf.Date'], ['exp', 'Exp.Date'], ['sDisc', 'S.Disc%'], ['sel', 'Sel.Amount'],
];
const GROUP_OF = (k) => (['name', 'generic', 'manufacturer', 'hsnCode', 'category', 'pack', 'unit'].includes(k) ? 'item'
  : ['batch', 'mfg', 'exp', 'sDisc', 'sel'].includes(k) ? 'si' : 'po');
const NUMERIC = new Set(['mrp', 'pRate', 'free', 'disc', 'qty', 'gst', 'sDisc', 'sel']);
const DERIVE_ONLY = ['oldPrice', 'amount', 'gstAmt', 'total', 'cgst', 'sgst'];
const MIN_BOX = 0.02;
const headKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
// A bill heading the reader didn't name, by its words: "Rate" → P.Rate, "GST %" → GST% …
const BY_LABEL = [
  ['cgst', (k) => k.startsWith('cgst') && !/amt|amount|value/.test(k)],
  ['sgst', (k) => k.startsWith('sgst') && !/amt|amount|value/.test(k)],
  ['gst', (k) => /^(gst|igst|tax)/.test(k) && !/amt|amount|value|able/.test(k)],
  ['free', (k) => k.startsWith('free') || k === 'fr'],
  ['disc', (k) => /^(disc|dis|discount|cd|sch)/.test(k) && !/amt|amount/.test(k)],
  ['oldPrice', (k) => /^(netrate|nrate|netprice|effrate)$/.test(k)],
  ['pRate', (k) => /^(rate|prate|ptr|pts|purrate|purchaserate|price)$/.test(k)],
  ['gstAmt', (k) => /^(gst|igst|tax)(amt|amount|value)$/.test(k)],
  ['amount', (k) => /^(amt|amount|value|taxable|taxablevalue|taxableamt|grossamt|grossamount)$/.test(k)],
  ['total', (k) => /^(total|netamt|netamount|nettotal|totalamt|totalamount)$/.test(k)],
  ['unit', (k) => /^(unit|uom|type)$/.test(k)],
  ['generic', (k) => /^(generic|genericname|composition|content)$/.test(k)],
  ['batch', (k) => /^(batch|batchno|bno|lot|lotno)$/.test(k)],
  ['sDisc', (k) => /^(sdisc|salesdisc|saledisc|sellingdisc)$/.test(k)],
  ['sel', (k) => /^(selamount|sellingprice|saleprice|salerate|sp|srate)$/.test(k)],
  ['exp', (k) => /^(exp|expy|expiry|expire|expires|expd|ed)(date|dt|on|mmyy|month)?$/.test(k) || k === 'expirydt'],
  ['mfg', (k) => /^(mfg|mfd|mf|md|mfgd|manufacturing|manufactured|manuf)(date|dt|on|mmyy|month)$/.test(k) || /^(mfd|md)$/.test(k)],
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A bill's month as 'YYYY-MM', or '' (2/28, 12/2027, 0527, MAY-27, 31/05/2027 …) */
function monthIn(text) {
  const t = String(text || '').toUpperCase().replace(/(?<=\d)O|O(?=\d)/g, '0').trim();
  const out = (mm, yy) => {
    const mo = Number(mm);
    if (!(mo >= 1 && mo <= 12)) return '';
    const y = String(yy).length === 2 ? `20${yy}` : String(yy);
    return /^20\d{2}$/.test(y) ? `${y}-${String(mo).padStart(2, '0')}` : '';
  };
  let m = /(?:^|\D)\d{1,2}\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return out(m[1], m[2]);
  m = /([A-Z]{3})[A-Z]*\.?\s*[-/.,']?\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m && MONTHS.includes(m[1])) return out(MONTHS.indexOf(m[1]) + 1, m[2]);
  m = /(?:^|\D)(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return out(m[1], m[2]);
  m = /^(\d{2})(\d{4}|\d{2})$/.exec(t.replace(/\s/g, ''));
  return m ? out(m[1], m[2]) : '';
}
const numIn = (t, last = false) => {
  const s = String(t || '').replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').replace(/,/g, '');
  const all = s.match(/\d+(\.\d+)?/g);
  return all ? String(Number(all[last ? all.length - 1 : 0])) : '';
};
function valueFor(key, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (key === 'exp' || key === 'mfg') return monthIn(t);
  if (key === 'mrp') return numIn(t, true);
  if (NUMERIC.has(key) || DERIVE_ONLY.includes(key)) return numIn(t);
  if (key === 'hsnCode') return t.replace(/[oO]/g, '0').replace(/\D/g, '').slice(0, 20);
  if (key === 'category' || key === 'batch') return t.replace(/ /g, '').toUpperCase().slice(0, key === 'batch' ? 50 : 100);
  const max = { name: 200, manufacturer: 150, generic: 150, pack: 50, unit: 30 }[key] || 100;
  return t.toUpperCase().slice(0, max);
}
/** The bill's Disc as a % of MRP: printed as a % or as an amount (per unit or for the line) */
function discPercent(text, o) {
  const t = String(text || '');
  const num = numIn(t);
  if (num === '') return '';
  const v = Number(num);
  const mrp = Number(o.mrp) || 0;
  const rate = Number(o.pRate) || 0;
  const qty = Number(o.qty) || 0;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.01);
  const pct = (x) => (x >= 0 && x <= 100 ? String(Math.round(x * 100) / 100) : '');
  if (/%/.test(t)) return pct(v);
  if (mrp > 0 && rate > 0) {
    if (near(mrp * (1 - v / 100), rate)) return pct(v);
    if (near(mrp - v, rate)) return pct((v / mrp) * 100);
    if (qty > 0 && near(mrp * qty - v, rate * qty)) return pct((v / (mrp * qty)) * 100);
  }
  if (v <= 100) return pct(v);
  if (!mrp) return '';
  if (v < mrp) return pct((v / mrp) * 100);
  return qty > 0 ? pct((v / (mrp * qty)) * 100) : '';
}
const TAX_PAIR = /^(\d+(?:\.\d+)?)\s*%?\s*[-+]*\+[-+]*\s*(\d+(?:\.\d+)?)\s*%?$/;
const taxPair = (text) => {
  const m = TAX_PAIR.exec(String(text || '').replace(/\s+/g, ' ').trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** One bill line through the column matches → its fields (P.Rate / GST % worked out when the bill has none) */
function fieldsOf(cells, map) {
  const o = {};
  for (const [key] of TARGETS) if (map[key] != null) o[key] = valueFor(key, cells[map[key]]);
  if (o.disc != null) o.disc = discPercent(cells[map.disc], o);
  const r2 = (n) => String(Math.round(n * 100) / 100);
  const n = (k) => Number(o[k]) || 0;
  for (const k of ['gst', 'cgst', 'sgst']) {
    const pair = map[k] != null ? taxPair(cells[map[k]]) : null;
    if (!pair) continue;
    if (k === 'gst') { o.gst = r2(pair[0] + pair[1]); continue; }
    if (k === 'cgst' || map.cgst == null) o.cgst = r2(pair[0]);
    if (k === 'sgst' || map.sgst == null) o.sgst = r2(pair[1]);
  }
  if (!(n('pRate') > 0)) {
    const net = n('amount') > 0 && n('qty') > 0 ? n('amount') / n('qty') : n('oldPrice');
    if (net > 0) o.pRate = r2(net);
  }
  if (!o.gst) {
    const amt = n('amount') || n('qty') * n('oldPrice');
    if (o.cgst || o.sgst) o.gst = r2(n('cgst') + n('sgst'));
    else if (amt > 0 && n('gstAmt') > 0) o.gst = r2((n('gstAmt') / amt) * 100);
    else if (amt > 0 && n('total') > amt) o.gst = r2(((n('total') - amt) / amt) * 100);
    if (o.gst && !(Number(o.gst) <= 100)) o.gst = '';
  }
  for (const k of DERIVE_ONLY) delete o[k];
  return o;
}
/** Tiles placed already: a column the reader named, or whose heading says what it is; dates by what they hold */
function autoMap(table) {
  const keys = new Set(TARGETS.map(([k]) => k));
  const map = {};
  table.heads.forEach((h, i) => {
    const field = h.field === 'category' ? 'batch' : h.field;   // the reader calls the Batch column "category"
    const key = keys.has(field) ? field : BY_LABEL.find(([k, test]) => keys.has(k) && test(headKey(h.label)))?.[0];
    if (key && map[key] == null) map[key] = i;
  });
  if (map.exp == null) {
    const taken = new Set(Object.values(map));
    const dated = table.heads.map((_, i) => i).filter((i) => {
      if (taken.has(i)) return false;
      const cells = table.rows.map((r) => String(r[i] || '').trim()).filter(Boolean);
      const months = cells.filter((t) => monthIn(t) && /[/\-.]|[A-Z]{3}/i.test(t) && !/\d{5,}/.test(t));
      return cells.length >= 2 && months.length >= cells.length * 0.6;
    });
    if (dated.length >= 2 && map.mfg == null) { map.mfg = dated[0]; map.exp = dated[1]; } else if (dated.length) map.exp = dated[dated.length - 1];
  }
  return map;
}

function Steps({ step, t }) {
  const all = [['pick', t('scan.stepUpload')], ['select', t('scan.stepSelect')], ['map', t('scan.stepMatch')], ['fill', t('scan.stepFill')]];
  const at = all.findIndex(([k]) => k === step);
  return (
    <ol className="scan-steps">
      {all.map(([k, label], i) => (
        <li key={k} className={i < at ? 'done' : i === at ? 'now' : ''}>
          <span className="scan-step-no">{i < at ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className="scan-step-label">{label}</span>
          {i < all.length - 1 && <span className="scan-step-line" />}
        </li>
      ))}
    </ol>
  );
}

function Progress({ busy }) {
  return (
    <div className="scan-progress">
      <div className="scan-progress-head"><Icon name="scan" size={14} /> {busy.stage}{busy.percent != null && <span>{busy.percent}%</span>}</div>
      <div className="scan-progress-bar"><span className={busy.percent == null ? 'busy' : ''} style={busy.percent != null ? { width: `${busy.percent}%` } : undefined} /></div>
    </div>
  );
}

/** The bill picture: drag on it (mouse or finger) to mark the area to read; box is in shares of the picture (0..1) */
function BoxSelect({ page, box, onBox, disabled, zoom, moving, hint }) {
  const url = useMemo(() => page.toDataURL('image/jpeg', 0.85), [page]);
  const wrap = useRef(null);
  const start = useRef(null);
  const [draft, setDraft] = useState(null);
  const at = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const down = (e) => {
    if (disabled || moving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = at(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const move = (e) => { if (start.current) setDraft(rectOf(start.current, at(e))); };
  const up = (e) => {
    if (!start.current) return;
    const r = rectOf(start.current, at(e));
    start.current = null;
    setDraft(null);
    if (r.w >= MIN_BOX && r.h >= MIN_BOX) onBox(r);
  };
  const shown = draft || box;
  const zoomed = zoom > 1;
  return (
    <div className={`scan-view ${zoomed ? '' : 'fit'}`}>
      <div ref={wrap} className={`scan-paper ${disabled ? 'wait' : moving ? 'move' : 'draw'}`}
        style={{ touchAction: moving ? 'pan-x pan-y' : 'none', width: zoomed ? `${zoom * 100}%` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDraft(null); }}>
        <img src={url} alt="" draggable={false} className={zoomed ? 'zoomed' : ''} />
        {shown && <div className="scan-box" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />}
        {!shown && <div className="scan-paper-hint"><span>{hint}</span></div>}
      </div>
    </div>
  );
}

/** Match columns: the bill's table as read; drag a tile onto a column (or tap the tile, then the column) */
function ColumnMatch({ table, map, setMap, onRemoveCol, onRemoveRow, disabled, t }) {
  const [picked, setPicked] = useState(null);   // { tile: key } or { col: index }, waiting for its partner
  const [over, setOver] = useState(null);
  const label = Object.fromEntries(TARGETS);
  const tileOn = (i) => Object.keys(map).find((k) => map[k] === i);
  const place = (key, i) => {
    setMap((m) => {
      const n = {};
      for (const [k, c] of Object.entries(m)) if (k !== key && c !== i) n[k] = c;
      n[key] = i;
      return n;
    });
    setPicked(null);
  };
  const clear = (key) => setMap((m) => { const n = { ...m }; delete n[key]; return n; });
  const tapTile = (key) => {
    if (disabled) return;
    if (picked?.col != null) place(key, picked.col);
    else setPicked((p) => (p?.tile === key ? null : { tile: key }));
  };
  const tapCol = (i) => {
    if (disabled) return;
    if (picked?.tile) place(picked.tile, i);
    else setPicked((p) => (p?.col === i ? null : { col: i }));
  };
  const dropProps = (i) => (disabled ? {} : {
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(i); },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e) => { e.preventDefault(); setOver(null); const key = e.dataTransfer.getData('text/plain'); if (label[key]) place(key, i); },
  });
  const dragTile = (key) => (e) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; setPicked(null); };
  const placed = Object.keys(map).length;

  return (
    <div className="scan-match">
      <p className="scan-lead"><b>{t('scan.matchLead')}</b> {t('scan.matchHint')}</p>
      <div className="scan-tiles-head">
        {t('scan.tilesHead', { n: placed })}
        {picked?.tile && <span className="scan-tiles-now"> — {t('scan.nowTapColumn', { name: label[picked.tile] })}</span>}
      </div>
      <div className="scan-tiles">
        {TARGETS.map(([key, name]) => {
          const on = map[key] != null;
          return (
            <button key={key} type="button" disabled={disabled} draggable={!disabled} onDragStart={dragTile(key)} onClick={() => tapTile(key)}
              className={`scan-tile scan-tile-${GROUP_OF(key)} ${picked?.tile === key ? 'picked' : on ? 'placed' : ''}`}
              title={on ? t('scan.tilePlaced') : t('scan.tileFree')}>
              <Icon name="grip" size={12} /> {name}{on && <Icon name="check" size={12} />}
            </button>
          );
        })}
      </div>
      <p className="muted scan-note">{t('scan.matchNote')}</p>

      <div className="scan-tiles-head">{t('scan.readLines', { n: table.rows.length })}</div>
      <div className="scan-table-wrap">
        <table className="scan-table" style={{ minWidth: 48 + table.heads.reduce((s, _, i) => s + (i === map.name || table.heads[i].field === 'name' ? 200 : 100), 0) }}>
          <thead>
            <tr>
              <th className="scan-no">#</th>
              {table.heads.map((h, i) => {
                const key = tileOn(i);
                const active = over === i || picked?.col === i;
                return (
                  <th key={i} style={{ width: i === map.name || h.field === 'name' ? 200 : 100 }}
                    className={`scan-slot ${active ? 'active' : ''} ${picked?.tile && !key ? 'waiting' : ''}`}
                    title={h.label || ''} onClick={() => tapCol(i)} {...dropProps(i)}>
                    {key ? (
                      <span className={`scan-slot-tile scan-tile-${GROUP_OF(key)}`} draggable={!disabled} onDragStart={dragTile(key)}>
                        <span>{label[key]}</span>
                        <button type="button" disabled={disabled} title={t('common.delete')} onClick={(e) => { e.stopPropagation(); clear(key); }}><Icon name="x" size={11} /></button>
                      </span>
                    ) : <span className="scan-slot-empty">{picked?.col === i ? t('scan.nowTapTile') : t('scan.dropTile')}</span>}
                  </th>
                );
              })}
            </tr>
            <tr className="scan-remove-row">
              <th />
              {table.heads.map((h, i) => (
                <th key={i}>
                  <small className="muted scan-bill-head">{h.label || '—'}</small>
                  <button type="button" className="scan-remove" disabled={disabled || table.heads.length <= 1}
                    onClick={() => { setPicked(null); setOver(null); onRemoveCol(i); }}><Icon name="trash" size={11} /> {t('scan.remove')}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((cells, r) => (
              <tr key={r}>
                <td className="scan-no">
                  {r + 1}
                  <button type="button" className="scan-remove" title={t('scan.removeLine')} disabled={disabled || table.rows.length <= 1} onClick={() => onRemoveRow(r)}><Icon name="trash" size={11} /></button>
                </td>
                {cells.map((c, i) => <td key={i} className={`${tileOn(i) ? '' : 'unused'} ${over === i ? 'over' : ''}`} {...dropProps(i)}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScanBillModal({ onClose, onLines }) {
  const { t } = useT();
  const [step, setStep] = useState('pick');   // pick | select | map
  const [pages, setPages] = useState([]);
  const [pageNo, setPageNo] = useState(0);
  const [box, setBox] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [moving, setMoving] = useState(false);
  const [table, setTable] = useState(null);
  const [colMap, setColMap] = useState({});
  const [header, setHeader] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(null);     // { stage, percent }
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const ocrRef = useRef(null);
  const readyRef = useRef(null);

  // the reader is made while the bill is being picked (its first use downloads the language data)
  const startOcr = () => {
    if (!ocrRef.current) {
      const p = import('../lib/billOcr.js').then((m) => m.createOcr());
      ocrRef.current = p;
      p.then(() => { readyRef.current = p; }, () => { if (ocrRef.current === p) ocrRef.current = null; });
    }
    return ocrRef.current;
  };
  const getOcr = () => {
    const p = startOcr();
    if (readyRef.current !== p) setBusy({ stage: t('scan.loadingOcr'), percent: null });
    return p;
  };
  useEffect(() => {
    startOcr();
    return () => { const o = ocrRef.current; ocrRef.current = null; o?.then((r) => r.done()).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const working = Boolean(busy);
  const page = pages[pageNo];

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setTable(null); setColMap({}); setHeader(null); setBox(null); setZoom(1); setMoving(false); setPageNo(0);
    setFileName(file.name);
    try {
      setBusy({ stage: t('scan.opening'), percent: null });
      const { loadBillPages, rotateCanvas } = await import('../lib/billOcr.js');
      const loaded = await loadBillPages(file);
      const ocr = await getOcr();
      setBusy({ stage: t('scan.turningAll'), percent: null });
      const upright = [];
      let deg = null;
      for (const p of loaded) {
        deg = await ocr.uprightAngle(p, deg);
        upright.push(rotateCanvas(p, deg));
      }
      setPages(upright);
      setStep('select');
    } catch (err) {
      setError(err.message || t('scan.cantOpen'));
      setStep('pick');
    } finally {
      setBusy(null);
    }
  }

  async function rotate(deg) {
    const { rotateCanvas } = await import('../lib/billOcr.js');
    setPages((ps) => ps.map((p, i) => (i === pageNo ? rotateCanvas(p, deg) : p)));
    setBox(null);
  }

  async function read(whole) {
    setError('');
    try {
      const ocr = await getOcr();
      const pct = (percent) => setBusy((b) => (b ? { ...b, percent } : b));
      setBusy({ stage: whole ? t('scan.readingWhole') : t('scan.readingArea'), percent: 0 });
      const { text, layout } = await ocr.read(page, whole ? null : box, pct);
      if (!header) {
        setBusy({ stage: t('scan.readingHeader'), percent: 0 });
        try {
          const top = await ocr.read(pages[0], { x: 0, y: 0, w: 1, h: 0.4 }, pct);
          setHeader(extractBillHeader(top.layout));
        } catch { setHeader({}); }
      }
      const billTable = extractBillTable(layout);
      if (billTable?.rows.length) {
        setTable(billTable);
        setColMap(autoMap(billTable));
        setStep('map');
        return;
      }
      // no header row read: the item lines with whatever columns could be told apart
      const rows = extractBillRows(layout)?.rows;
      const found = rows?.length ? rows : extractItems(text, layout, { column: !whole });
      if (!found.length) { setError(whole ? t('scan.noneWhole') : t('scan.noneArea')); return; }
      onLines(found.map((f) => ({
        name: f.name, hsnCode: f.hsnCode || '', manufacturer: f.manufacturer || '', batch: f.category || '', pack: f.pack || '',
        mrp: f.mrp || '', qty: f.qty || '',
      })), header);
      onClose();
    } catch (err) {
      setError(err.message || t('scan.cantRead'));
    } finally {
      setBusy(null);
    }
  }

  const names = colMap.name == null || !table ? 0 : table.rows.filter((cells) => compact(cells[colMap.name])).length;
  function fill() {
    onLines(table.rows.map((cells) => fieldsOf(cells, colMap)).filter((f) => compact(f.name)), header);
    onClose();
  }

  const footer = step === 'select' ? (
    <>
      <Button type="button" variant="ghost" disabled={working} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> {t('scan.another')}</Button>
      <span className="scan-foot-gap" />
      {box && <Button type="button" variant="ghost" disabled={working} onClick={() => setBox(null)}><Icon name="x" size={16} /> {t('scan.cancelBox')}</Button>}
      <Button type="button" variant="ghost" disabled={working} onClick={() => read(true)}><Icon name="sparkles" size={16} /> {t('scan.readWhole')}</Button>
      <Button type="button" disabled={working || !box} onClick={() => read(false)}><Icon name="crop" size={16} /> {box ? t('scan.readArea') : t('scan.selectFirst')}</Button>
    </>
  ) : step === 'map' ? (
    <>
      <Button type="button" variant="ghost" disabled={working} onClick={() => setStep('select')}><Icon name="arrowLeft" size={16} /> {t('scan.selectAgain')}</Button>
      <Button type="button" variant="ghost" disabled={working || !Object.keys(colMap).length} onClick={() => setColMap({})}><Icon name="eraser" size={16} /> {t('scan.clearAll')}</Button>
      <span className="scan-foot-gap" />
      {colMap.name == null && <small className="scan-warn">{t('scan.needName')}</small>}
      <Button type="button" disabled={working || !names} onClick={fill}><Icon name="plus" size={16} /> {t('scan.fillN', { n: names })}</Button>
    </>
  ) : null;

  return (
    <Modal title={t('scan.modalTitle')} onClose={working ? () => {} : onClose} wide footer={footer}>
      <div className="scan-bill">
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={onFile} />
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <Steps step={step} t={t} />

        {step === 'pick' && !busy && (
          <div className="scan-drop">
            <span className="scan-drop-icon"><Icon name="scan" size={30} /></span>
            <b>{t('scan.uploadTitle')}</b>
            <p>{t('scan.uploadHint')}</p>
            <div className="scan-drop-buttons">
              <Button type="button" variant="ghost" className="scan-photo-btn" onClick={() => photoRef.current?.click()}><Icon name="camera" size={16} /> {t('scan.takePhoto')}</Button>
              <Button type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> {t('scan.uploadBtn')}</Button>
            </div>
          </div>
        )}

        {busy && <Progress busy={busy} />}
        {error && <div className="alert alert-error">{error}</div>}

        {step === 'select' && page && (
          <>
            <div className="scan-toolbar">
              <p className="scan-lead"><b>{t('scan.selectLead')}</b> {t('scan.selectHint')}</p>
              <div className="scan-tools">
                {pages.length > 1 && (
                  <>
                    <button type="button" className="icon-btn" disabled={working || pageNo === 0} title={t('scan.prevPage')} onClick={() => { setPageNo((n) => n - 1); setBox(null); }}><Icon name="chevronLeft" size={16} /></button>
                    <span className="muted">{t('scan.pageOf', { n: pageNo + 1, of: pages.length })}</span>
                    <button type="button" className="icon-btn" disabled={working || pageNo === pages.length - 1} title={t('scan.nextPage')} onClick={() => { setPageNo((n) => n + 1); setBox(null); }}><Icon name="chevronRight" size={16} /></button>
                    <span className="scan-sep" />
                  </>
                )}
                <button type="button" className="icon-btn" disabled={working} title={t('scan.turnLeft')} onClick={() => rotate(270)}><Icon name="rotateLeft" size={16} /></button>
                <button type="button" className="icon-btn" disabled={working} title={t('scan.turnRight')} onClick={() => rotate(90)}><Icon name="rotateRight" size={16} /></button>
                <span className="scan-sep" />
                <button type="button" className="icon-btn" disabled={zoom === 1} title={t('scan.zoomOut')} onClick={() => { const z = zoom - 1; setZoom(z); if (z === 1) setMoving(false); }}><Icon name="zoomOut" size={16} /></button>
                <span className="muted scan-zoom">{zoom}×</span>
                <button type="button" className="icon-btn" disabled={zoom === 3} title={t('scan.zoomIn')} onClick={() => setZoom((z) => z + 1)}><Icon name="zoomIn" size={16} /></button>
                {zoom > 1 && (
                  <span className="scan-mode">
                    <button type="button" className={moving ? 'on' : ''} onClick={() => setMoving(true)}><Icon name="hand" size={13} /> {t('scan.move')}</button>
                    <button type="button" className={!moving ? 'on' : ''} onClick={() => setMoving(false)}><Icon name="crop" size={13} /> {t('scan.select')}</button>
                  </span>
                )}
              </div>
            </div>
            <BoxSelect page={page} box={box} onBox={setBox} disabled={working} zoom={zoom} moving={moving} hint={t('scan.dragHint')} />
            <p className="muted scan-file">{fileName}</p>
          </>
        )}

        {step === 'map' && table && (
          <ColumnMatch table={table} map={colMap} setMap={setColMap} disabled={working} t={t}
            onRemoveCol={(i) => {
              setTable((tb) => ({ heads: tb.heads.filter((_, c) => c !== i), rows: tb.rows.map((r) => r.filter((_, c) => c !== i)) }));
              setColMap((m) => Object.fromEntries(Object.entries(m).filter(([, c]) => c !== i).map(([k, c]) => [k, c > i ? c - 1 : c])));
            }}
            onRemoveRow={(r) => setTable((tb) => ({ ...tb, rows: tb.rows.filter((_, x) => x !== r) }))} />
        )}
      </div>
    </Modal>
  );
}
