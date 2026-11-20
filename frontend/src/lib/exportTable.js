// Excel (.xlsx) and PDF export of a table, for the pharmacy lists and reports.
// columns: [{ label, value: (row) => text | number, type?: 'money' | 'qty' | 'date' | 'percent' | 'text' }]
// The libraries (SheetJS, jsPDF) load only when an export is made.
import { fmtDate } from './format.js';

const cellOf = (c, r) => {
  const v = c.value(r);
  if (v == null || v === '') return '';
  if (c.type === 'date') return fmtDate(v);
  if (['money', 'qty', 'percent'].includes(c.type)) {
    const n = Number(v);
    return Number.isFinite(n) ? (c.type === 'money' ? Math.round(n * 100) / 100 : n) : v;
  }
  return String(v);
};

const safeName = (s) => String(s || 'export').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'export';
const stamp = () => new Date().toISOString().slice(0, 10);

/** Saves rows as an Excel sheet: a title row, a blank row, then the headings and the rows. */
export async function exportExcel({ title, columns, rows, subtitle }) {
  const XLSX = await import('xlsx');
  const aoa = [[title], ...(subtitle ? [[subtitle]] : []), [], columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => cellOf(c, r)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map((c) => ({
    wch: Math.min(40, Math.max(c.label.length, ...rows.slice(0, 200).map((r) => String(cellOf(c, r)).length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeName(title).slice(0, 31));
  XLSX.writeFile(wb, `${safeName(title)}_${stamp()}.xlsx`);
}

/** Saves rows as an A4 PDF table (landscape when there are many columns), with the clinic name on top. */
export async function exportPdf({ title, columns, rows, subtitle, clinic }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  let y = 36;
  if (clinic) { doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.text(String(clinic), 40, y); y += 18; }
  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text(String(title), 40, y); y += 14;
  if (subtitle) { doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.text(String(subtitle), 40, y); y += 12; }
  const right = new Set(columns.map((c, i) => (['money', 'qty', 'percent'].includes(c.type) ? i : -1)).filter((i) => i >= 0));
  autoTable(doc, {
    startY: y + 4,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => {
      const v = cellOf(c, r);
      return c.type === 'money' && v !== '' ? Number(v).toFixed(2) : String(v);
    })),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [23, 66, 95] },
    columnStyles: Object.fromEntries([...right].map((i) => [i, { halign: 'right' }])),
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.text(`${stamp()} · page ${doc.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
    },
  });
  doc.save(`${safeName(title)}_${stamp()}.pdf`);
}

/** Fetches every page of a paged list (`fetchPage(page)` → { rows, total, limit }), at most `max` rows. */
export async function fetchAll(fetchPage, max = 5000) {
  const first = await fetchPage(1);
  const rows = [...first.rows];
  const pages = Math.min(Math.ceil((first.total || 0) / (first.limit || 1)), Math.ceil(max / (first.limit || 1)));
  for (let p = 2; p <= pages; p += 1) rows.push(...(await fetchPage(p)).rows);
  return rows.slice(0, max);
}
