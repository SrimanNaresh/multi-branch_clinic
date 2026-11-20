// Stock In → Three in One → Scan Bill: read a supplier bill (photo or PDF) with OCR in the browser, pick out its
// item rows (name, HSN, MFR, batch, pack, MRP, qty) and the bill date / supplier GSTIN, match each name with the
// Item list, then add the ticked rows to the Three in One table for checking. Nothing is saved here.
// OCR (Tesseract) and PDF.js load only when a bill is scanned (lib/billOcr.js, lib/billScan.js from All In One).
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { buildIndex, extractBillHeader, extractBillRows, extractItems, matchName } from '../lib/billScan.js';
import { Button, Empty, Modal } from './ui.jsx';
import Icon from './Icon.jsx';

const NEW = 'new';

export default function ScanBillModal({ onClose, onAdd }) {
  const { t } = useT();
  const [pages, setPages] = useState([]);
  const [status, setStatus] = useState('');
  const [percent, setPercent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [header, setHeader] = useState(null);
  const [error, setError] = useState('');
  const ocr = useRef(null);
  const items = useRef(null);

  useEffect(() => () => { ocr.current?.then((o) => o.done()).catch(() => {}); }, []);

  async function choose(file) {
    if (!file) return;
    setError('');
    setRows(null);
    setHeader(null);
    setBusy(true);
    setStatus(t('scan.opening'));
    try {
      const { loadBillPages } = await import('../lib/billOcr.js');
      setPages(await loadBillPages(file));
      setStatus('');
    } catch (err) {
      setError(err.message);
      setPages([]);
    } finally {
      setBusy(false);
    }
  }

  async function read() {
    setBusy(true);
    setError('');
    try {
      if (!ocr.current) ocr.current = import('../lib/billOcr.js').then((m) => m.createOcr());
      if (!items.current) items.current = api('/ips/items').then((r) => buildIndex(r.rows));
      setStatus(t('scan.loadingOcr'));
      const reader = await ocr.current;
      const { rotateCanvas } = await import('../lib/billOcr.js');
      let firstDeg = null;
      const layouts = [];
      const texts = [];
      for (const [n, page] of pages.entries()) {
        setStatus(t('scan.turning', { n: n + 1, of: pages.length }));
        const deg = await reader.uprightAngle(page, firstDeg);
        if (firstDeg == null) firstDeg = deg;
        setStatus(t('scan.reading', { n: n + 1, of: pages.length }));
        const { text, layout } = await reader.read(rotateCanvas(page, deg), null, setPercent);
        layouts.push(layout);
        texts.push(text);
      }
      setPercent(null);
      const all = layouts.flat();
      setHeader(extractBillHeader(layouts[0]));
      const table = extractBillRows(all);
      const found = table?.rows?.length ? table.rows : extractItems(texts.join('\n'), all);
      const index = await items.current;
      setRows(found.map((r, i) => {
        const m = matchName(r.name, index);
        const item = m.exact || m.likely;
        return {
          key: i, use: true, name: r.name, hsn: r.hsnCode || '', mfr: r.manufacturer || '', batch: r.category || '', pack: r.pack || '',
          mrp: r.mrp || '', qty: r.qty || '', pick: item ? String(item.id) : NEW,
          options: [...(m.exact ? [m.exact] : []), ...m.similar.map((s) => s.item)].filter((x, j, a) => a.findIndex((y) => y.id === x.id) === j),
        };
      }));
      setStatus('');
    } catch (err) {
      setError(err.message || String(err));
      setStatus('');
    } finally {
      setBusy(false);
      setPercent(null);
    }
  }

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const ticked = (rows || []).filter((r) => r.use && r.name.trim());

  function add() {
    onAdd(ticked.map((r) => ({
      item: r.pick === NEW ? null : r.options.find((o) => String(o.id) === r.pick) || null,
      name: r.name, hsn_code: r.hsn, manufacturer: r.mfr, batch_no: r.batch, pack: r.pack, mrp: r.mrp, qty: r.qty,
    })), header);
    onClose();
  }

  return (
    <Modal title={t('scan.title')} onClose={onClose} wide
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" disabled={!ticked.length} onClick={add}><Icon name="plus" size={16} /> {t('scan.add', { n: ticked.length })}</Button>
        </>
      )}>
      <p className="muted">{t('scan.hint')}</p>
      <div className="toolbar">
        <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
        <Button type="button" size="sm" disabled={busy || !pages.length} loading={busy && !!pages.length} onClick={read}>
          <Icon name="search" size={15} /> {t('scan.read')}
        </Button>
        {status && <span className="muted">{status}{percent != null ? ` ${percent}%` : ''}</span>}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {pages.length > 0 && !rows && (
        <div className="scan-pages">
          {pages.map((p, n) => <img key={n} src={p.toDataURL('image/jpeg', 0.6)} alt={t('scan.page', { n: n + 1 })} />)}
        </div>
      )}
      {header && (header.billDate || header.gstNo || header.mobile) && (
        <p className="muted">{t('scan.headerRead', { date: header.billDate || '—', gst: header.gstNo || '—', mobile: header.mobile || '—' })}</p>
      )}
      {rows && (rows.length ? (
        <div className="table-wrap po-lines">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>{t('scan.billName')}</th>
                <th>{t('scan.match')}</th>
                <th>HSN</th>
                <th>{t('stockin.batch')}</th>
                <th>{t('items.pack')}</th>
                <th className="num">{t('items.mrp')}</th>
                <th className="num">{t('items.quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><input type="checkbox" checked={r.use} aria-label={r.name} onChange={(e) => setRow(r.key, { use: e.target.checked })} /></td>
                  <td><input value={r.name} aria-label={t('scan.billName')} onChange={(e) => setRow(r.key, { name: e.target.value })} /></td>
                  <td>
                    <select value={r.pick} aria-label={t('scan.match')} onChange={(e) => setRow(r.key, { pick: e.target.value })}>
                      <option value={NEW}>{t('scan.newItem')}</option>
                      {r.options.map((o) => <option key={o.id} value={String(o.id)}>{o.name}{o.unit ? ` (${o.unit})` : ''}</option>)}
                    </select>
                  </td>
                  <td><input value={r.hsn} aria-label="HSN" onChange={(e) => setRow(r.key, { hsn: e.target.value })} /></td>
                  <td><input value={r.batch} aria-label={t('stockin.batch')} onChange={(e) => setRow(r.key, { batch: e.target.value })} /></td>
                  <td><input value={r.pack} aria-label={t('items.pack')} onChange={(e) => setRow(r.key, { pack: e.target.value })} /></td>
                  <td><input type="number" min="0" step="0.01" value={r.mrp} aria-label={t('items.mrp')} onChange={(e) => setRow(r.key, { mrp: e.target.value })} /></td>
                  <td><input type="number" min="0" step="0.01" value={r.qty} aria-label={t('items.quantity')} onChange={(e) => setRow(r.key, { qty: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>{t('scan.none')}</Empty>)}
    </Modal>
  );
}
