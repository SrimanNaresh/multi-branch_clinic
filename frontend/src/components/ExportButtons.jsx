// Excel / PDF buttons for a list or report. getRows() returns every row to export (all pages, not just the one
// on screen); columns as in lib/exportTable.js. The clinic name heads the PDF.
import { useState } from 'react';
import { useT } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { exportExcel, exportPdf } from '../lib/exportTable.js';
import { Button, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

export default function ExportButtons({ title, subtitle, columns, getRows }) {
  const { t } = useT();
  const toast = useToast();
  const auth = useAuth();
  const [busy, setBusy] = useState('');

  async function run(kind) {
    setBusy(kind);
    try {
      const rows = await getRows();
      if (!rows.length) { toast(t('export.nothing'), 'error'); return; }
      const clinic = auth.activeClinic?.name;
      if (kind === 'xlsx') await exportExcel({ title, subtitle, columns, rows });
      else await exportPdf({ title, subtitle, columns, rows, clinic });
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <span className="row-actions export-buttons">
      <Button type="button" size="sm" variant="ghost" loading={busy === 'xlsx'} onClick={() => run('xlsx')}><Icon name="download" size={15} /> Excel</Button>
      <Button type="button" size="sm" variant="ghost" loading={busy === 'pdf'} onClick={() => run('pdf')}><Icon name="file" size={15} /> PDF</Button>
    </span>
  );
}
