// Pharmacy → Item: "Template" downloads the CSV template, "Import" reads a filled-in copy,
// shows a preview with any problems per line, then imports (all rows or none).
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { checkItemRows, decodeFile, MAX_IMPORT_ROWS, rowsFromCsv, templateCsv } from '../../../shared/itemImport.js';
import { Button, Modal, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

export function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'item-import-template.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ItemImportButtons({ onImported }) {
  const { t } = useT();
  const toast = useToast();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);   // { fileName, rows: [{ line, data, errors }] }
  const [saving, setSaving] = useState(false);

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';                           // the same file can be chosen again after fixing it
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { toast(t('itemImport.csvOnly'), 'error'); return; }
    const { rows, missing, found } = rowsFromCsv(decodeFile(await file.arrayBuffer()));
    if (missing.length) {
      toast(t('itemImport.missingColumns', { cols: missing.join(', '), found: found.slice(0, 8).join(', ') || '—' }), 'error');
      return;
    }
    if (!rows.length) { toast(t('itemImport.empty'), 'error'); return; }
    if (rows.length > MAX_IMPORT_ROWS) { toast(t('itemImport.tooMany', { n: MAX_IMPORT_ROWS }), 'error'); return; }
    const checked = checkItemRows(rows);
    setPreview({ fileName: file.name, raw: rows, rows: checked });
  }

  async function doImport() {
    setSaving(true);
    try {
      const r = await api('/items/import', { method: 'POST', body: { rows: preview.raw } });
      toast(t('itemImport.done', { created: r.created, updated: r.updated }));
      setPreview(null);
      onImported?.();
    } catch (err) {
      if (err.code === 'IMPORT_INVALID' && Array.isArray(err.details)) {
        // show the server's findings on the matching lines
        const byLine = new Map(err.details.map((d) => [d.line, d.errors]));
        setPreview((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, errors: byLine.get(r.line) || [] })) }));
      }
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const bad = preview?.rows.filter((r) => r.errors.length).length || 0;
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}><Icon name="download" size={15} /> {t('itemImport.template')}</Button>
      <Button type="button" size="sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /> {t('itemImport.import')}</Button>
      <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={readFile} />

      {preview && (
        <Modal wide title={t('itemImport.previewTitle', { file: preview.fileName })} onClose={() => !saving && setPreview(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={saving}>{t('common.cancel')}</Button>
              <Button onClick={doImport} loading={saving} disabled={bad > 0}>{t('itemImport.importN', { n: preview.rows.length })}</Button>
            </>
          )}>
          <p className={bad ? 'alert alert-error' : 'muted'}>
            {bad ? t('itemImport.fixFirst', { n: bad }) : t('itemImport.ready', { n: preview.rows.length })}
          </p>
          <div className="table-wrap import-preview">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('itemImport.line')}</th><th>{t('items.name')}</th><th>{t('items.unit')}</th>
                  <th>{t('items.category')}</th><th className="num">{t('items.mrp')}</th><th className="num">{t('items.sellPrice')}</th>
                  <th>{t('field.status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-error' : ''}>
                    <td data-label={t('itemImport.line')}>{r.line}</td>
                    <td data-label={t('items.name')}>{r.data.name || '—'}</td>
                    <td data-label={t('items.unit')}>{r.data.unit}</td>
                    <td data-label={t('items.category')}>{r.data.category || '—'}</td>
                    <td data-label={t('items.mrp')} className="num">{r.data.mrp}</td>
                    <td data-label={t('items.sellPrice')} className="num">{r.data.price}</td>
                    <td data-label={t('field.status')}>
                      {r.errors.length
                        ? <span className="field-error">{r.errors.map((e) => t(`itemImport.err.${e.code}`)).join('; ')}</span>
                        : <span className="badge badge-success">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('itemImport.hint')}</p>
        </Modal>
      )}
    </>
  );
}
