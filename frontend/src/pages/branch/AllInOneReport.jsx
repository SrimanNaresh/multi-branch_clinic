// Pharmacy → Report → All in One: pick a screen (Item, Vendor, Purchase / Order, Stock In, Returns, Sales,
// Adjustment, Vendor Payments), tick the columns to show, optionally a date range and filter values, then Show.
// Picking an item-line column lists one row per line. Excel / PDF export what is shown.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { fmtDate, money } from '../../lib/format.js';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, useAsync } from '../../components/ui.jsx';
import ExportButtons from '../../components/ExportButtons.jsx';
import Icon from '../../components/Icon.jsx';

const show = (type, v) => {
  if (v == null || v === '') return '—';
  if (type === 'date') return fmtDate(v);
  if (type === 'money') return money(v);
  if (type === 'qty' || type === 'percent') return String(Math.round(Number(v) * 10000) / 10000);
  return String(v);
};

/** A filter column's values as a small multi-select list */
function FilterBox({ screen, col, value, onChange }) {
  const { t } = useT();
  const vals = useAsync(() => api('/all-in-one/values', { query: { screen, column: col.key } }), [screen, col.key]);
  return (
    <label className="field aio-filter">
      <span className="field-label">{col.label}</span>
      <select multiple size={4} value={value} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
        {(vals.data || []).map((v) => <option key={v} value={v}>{v === '' ? t('aio.blank') : v}</option>)}
      </select>
    </label>
  );
}

export default function AllInOneReport() {
  const { t } = useT();
  const screens = useAsync(() => api('/all-in-one/screens'), []);
  const [screen, setScreen] = useState('');
  const [cols, setCols] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const s = useMemo(() => (screens.data || []).find((x) => x.key === screen), [screens.data, screen]);
  useEffect(() => {
    // a new screen starts with its document columns ticked
    setCols(s ? s.columns.filter((c) => !c.line).map((c) => c.key) : []);
    setFilters({});
    setResult(null);
  }, [s]);

  const toggle = (key) => setCols((cs) => (cs.includes(key) ? cs.filter((k) => k !== key) : [...cs, key]));
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const order = s.columns.map((c) => c.key).filter((k) => cols.includes(k));
      setResult(await api('/all-in-one', { query: { screen, columns: order.join(','), ...range, filters: JSON.stringify(filters) } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const exportCols = (result?.columns || []).map((c) => ({ label: c.label, type: c.type, value: (r) => r[c.key] }));
  const head = s?.columns.filter((c) => !c.line) || [];
  const line = s?.columns.filter((c) => c.line) || [];
  const box = (c) => (
    <label key={c.key} className="aio-col"><input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}</label>
  );

  return (
    <>
      <PageHeader compact title={t('aio.title')} subtitle={t('aio.subtitle')} />
      <Card className="crud-compact">
        {screens.loading && <Loading />}
        <ErrorBox error={screens.error} onRetry={screens.reload} />
        <div className="form-grid">
          <Select label={t('aio.screen')} placeholder="—" value={screen}
            options={(screens.data || []).map((x) => ({ value: x.key, label: x.label }))} onChange={(e) => setScreen(e.target.value)} />
          {s?.hasDate && (
            <>
              <Input label={t('vp.from')} type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              <Input label={t('vp.to')} type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </>
          )}
        </div>
        {s && (
          <>
            <div className="aio-cols">
              <div className="aio-cols-group">
                <b>{line.length ? t('aio.docColumns') : t('aio.columns')}</b>
                <span className="aio-cols-list">{head.map(box)}</span>
              </div>
              {line.length > 0 && (
                <div className="aio-cols-group">
                  <b>{t('aio.lineColumns')}</b> <span className="muted">{t('aio.lineHint')}</span>
                  <span className="aio-cols-list">{line.map(box)}</span>
                </div>
              )}
            </div>
            {s.columns.some((c) => c.filter) && (
              <div className="form-grid aio-filters">
                {s.columns.filter((c) => c.filter).map((c) => (
                  <FilterBox key={c.key} screen={screen} col={c} value={filters[c.key] || []}
                    onChange={(v) => setFilters((f) => ({ ...f, [c.key]: v }))} />
                ))}
              </div>
            )}
            <div className="toolbar">
              <Button type="button" loading={busy} disabled={!cols.length} onClick={run}><Icon name="search" size={16} /> {t('aio.show')}</Button>
              {result && (
                <ExportButtons title={`${t('aio.title')} – ${s.label}`}
                  subtitle={[range.from && `${t('vp.from')} ${fmtDate(range.from)}`, range.to && `${t('vp.to')} ${fmtDate(range.to)}`].filter(Boolean).join(' · ')}
                  columns={exportCols} getRows={async () => result.rows} />
              )}
              {result && <span className="muted">{t('aio.count', { n: result.rows.length })}{result.capped ? ` · ${t('aio.capped')}` : ''}</span>}
            </div>
          </>
        )}
        <ErrorBox error={error} />
        {result && (result.rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>{result.columns.map((c) => <th key={c.key} className={['money', 'qty', 'percent'].includes(c.type) ? 'num' : undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.map((r, n) => (
                  <tr key={n}>
                    {result.columns.map((c) => <td key={c.key} className={['money', 'qty', 'percent'].includes(c.type) ? 'num' : undefined}>{show(c.type, r[c.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t('aio.none')}</Empty>)}
      </Card>
    </>
  );
}
