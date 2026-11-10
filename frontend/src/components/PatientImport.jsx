// Registration → Patient Registration / Patient List:
//  "Template" downloads the CSV template (same fields as the registration screen),
//  "Import" reads a filled-in copy, shows a preview with any problems per line, then imports (all rows or none),
//  "Download" saves every patient of the clinic as a CSV file.
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import {
  checkPatientRows, decodeFile, MAX_PATIENT_IMPORT, patientRowsFromCsv, patientsCsv, patientTemplateCsv,
} from '../../../shared/patientImport.js';
import { Button, Modal, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

function saveCsv(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

export function PatientDownloadButton({ clinicCode }) {
  const { t } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const { rows } = await api('/patients/export');
      saveCsv(patientsCsv(rows), `patients-${clinicCode || 'clinic'}-${today()}.csv`);
      toast(t('patientImport.downloaded', { n: rows.length }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return <Button type="button" variant="ghost" size="sm" loading={busy} onClick={download}><Icon name="download" size={15} /> {t('patientImport.download')}</Button>;
}

export default function PatientImportButtons({ onImported }) {
  const { t } = useT();
  const toast = useToast();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);   // { fileName, raw, rows: [{ line, data, errors }] }
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';                           // the same file can be chosen again after fixing it
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { toast(t('itemImport.csvOnly'), 'error'); return; }
    const { rows, missing, found } = patientRowsFromCsv(decodeFile(await file.arrayBuffer()));
    if (missing.length) {
      toast(t('itemImport.missingColumns', { cols: missing.join(', '), found: found.slice(0, 8).join(', ') || '—' }), 'error');
      return;
    }
    if (!rows.length) { toast(t('patientImport.empty'), 'error'); return; }
    if (rows.length > MAX_PATIENT_IMPORT) { toast(t('itemImport.tooMany', { n: MAX_PATIENT_IMPORT }), 'error'); return; }
    setPreview({ fileName: file.name, raw: rows, rows: checkPatientRows(rows) });
  }

  async function doImport() {
    setSaving(true);
    try {
      const r = await api('/patients/import', { method: 'POST', body: { rows: preview.raw } });
      setPreview(null);
      setResult(r);
      onImported?.();
    } catch (err) {
      if (err.code === 'IMPORT_INVALID' && Array.isArray(err.details)) {
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
      <Button type="button" variant="ghost" size="sm" onClick={() => saveCsv(patientTemplateCsv(), 'patient-import-template.csv')}>
        <Icon name="download" size={15} /> {t('itemImport.template')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /> {t('itemImport.import')}</Button>
      <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={readFile} />

      {preview && (
        <Modal wide title={t('patientImport.previewTitle', { file: preview.fileName })} onClose={() => !saving && setPreview(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={saving}>{t('common.cancel')}</Button>
              <Button onClick={doImport} loading={saving} disabled={bad > 0}>{t('patientImport.importN', { n: preview.rows.length })}</Button>
            </>
          )}>
          <p className={bad ? 'alert alert-error' : 'muted'}>
            {bad ? t('itemImport.fixFirst', { n: bad }) : t('itemImport.ready', { n: preview.rows.length })}
          </p>
          <div className="table-wrap import-preview">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('itemImport.line')}</th><th>{t('field.patientId')}</th><th>{t('field.name')}</th><th>{t('field.genderAge')}</th>
                  <th>{t('field.dob')}</th><th>{t('field.mobile')}</th><th>{t('field.bloodGroup')}</th><th>{t('patientImport.createDate')}</th><th>{t('field.status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-error' : ''}>
                    <td data-label={t('itemImport.line')}>{r.line}</td>
                    <td data-label={t('field.patientId')}>{r.data.patient_code || <span className="muted">{t('patientImport.autoId')}</span>}</td>
                    <td data-label={t('field.name')}>{r.data.name || '—'}</td>
                    <td data-label={t('field.genderAge')}>{r.data.gender ? t(`gender.${r.data.gender}`) : '—'} / {r.data.age_years ?? '—'}</td>
                    <td data-label={t('field.dob')}>{r.data.dob || '—'}</td>
                    <td data-label={t('field.mobile')}>{r.data.mobile || '—'}</td>
                    <td data-label={t('field.bloodGroup')}>{r.data.blood_group || '—'}</td>
                    <td data-label={t('patientImport.createDate')}>{r.data.created_at || <span className="muted">{t('patientImport.today')}</span>}</td>
                    <td data-label={t('field.status')}>
                      {r.errors.length
                        ? <span className="field-error">{r.errors.map((e) => t(`patientImport.err.${e.code}`)).join('; ')}</span>
                        : <span className="badge badge-success">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('patientImport.hint')}</p>
        </Modal>
      )}

      {result && (
        <Modal title={t('patientImport.doneTitle')} onClose={() => setResult(null)}
          footer={<Button onClick={() => setResult(null)}>{t('common.close')}</Button>}>
          <p>
            {result.created
              ? t('patientImport.created', { n: result.created, first: result.first, last: result.last })
              : t('patientImport.noneCreated')}
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="muted">{t('patientImport.skipped', { n: result.skipped.length })}</p>
              <ul className="small">
                {result.skipped.map((s) => (
                  <li key={s.line}>{t('itemImport.line')} {s.line}: {s.name} – {s.reason === 'idUsed'
                    ? t('patientImport.idUsed', { code: s.patient_code, other: s.other })
                    : t('patientImport.sameAs', { code: s.patient_code })}</li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
