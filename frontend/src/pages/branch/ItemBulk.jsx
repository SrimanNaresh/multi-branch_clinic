// Pharmacy → Item → Bulk Update: the item list as an editable table. Change values in as many rows as needed
// (across pages and searches – changes are kept until saved or discarded), then one Save updates them all.
// Changed cells are highlighted; if any row is wrong nothing is saved and that row shows why.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { arrowMove } from '../../lib/tableKeys.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, SearchBox, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

// [field, label key, input kind] – 'list': a drop-down of that list's values
const FIELDS = [
  ['category', 'items.category', 'list'],
  ['potency', 'items.potency', 'list'],
  ['pack', 'items.pack', 'list'],
  ['hsn_code', 'items.hsn', 'text'],
  ['manufacturer', 'items.manufacturer', 'text'],
  ['mrp', 'items.mrp', 'num'],
  ['cgst_percent', 'items.cgst', 'num'],
  ['sgst_percent', 'items.sgst', 'num'],
  ['rack', 'items.rack', 'text'],
  ['box', 'items.box', 'text'],
  ['status', 'field.status', 'status'],
];
const asText = (v, kind) => (v == null ? '' : kind === 'num' ? String(Number(v)) : String(v));

export default function ItemBulk() {
  const { t } = useT();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState({});       // { itemId: { field: value } } – only what differs from the saved item
  const [originals, setOriginals] = useState({}); // { itemId: item } for every edited item (name for messages)
  const [rowErrors, setRowErrors] = useState({}); // { itemId: message } from the last Save
  const [saving, setSaving] = useState(false);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/items', { query: { q: dq, category, page, limit: 50 } }), [dq, category, page]);
  const cats = useAsync(() => api('/items/categories'), []);
  // drop-down choices: Category and Potency are the lists kept on the Item screen (+ New / Edit / Delete),
  // Pack the packs items already use
  const lists = useAsync(async () => {
    const [category, potency, opts] = await Promise.all([
      api('/visits/category-options'), api('/visits/itempotency-options'), api('/items/options'),
    ]);
    return { category: category.rows, potency: potency.rows, pack: opts.packs || [] };
  }, []);
  /** The choices for one cell: the list, plus the item's own value if the list does not have it */
  const choicesFor = (field, value) => {
    const list = lists.data?.[field] || [];
    return value && !list.some((v) => v.toLowerCase() === value.toLowerCase()) ? [value, ...list] : list;
  };
  const changedCount = Object.keys(edits).length;

  const valueOf = (item, field, kind) => (edits[item.id] && field in edits[item.id] ? edits[item.id][field] : asText(item[field], kind));
  function setValue(item, field, kind, value) {
    setEdits((all) => {
      const row = { ...(all[item.id] || {}) };
      if (value === asText(item[field], kind)) delete row[field]; else row[field] = value;
      const next = { ...all };
      if (Object.keys(row).length) next[item.id] = row; else delete next[item.id];
      return next;
    });
    setOriginals((o) => (o[item.id] ? o : { ...o, [item.id]: item }));
    setRowErrors((e) => {
      if (!e[item.id]) return e;
      const next = { ...e };
      delete next[item.id];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const rows = Object.entries(edits).map(([id, f]) => ({ id: Number(id), ...f }));
      const r = await api('/items/bulk', { method: 'POST', body: { rows } });
      toast(t('bulk.saved', { n: r.updated }));
      setEdits({});
      setOriginals({});
      setRowErrors({});
      list.reload();
    } catch (err) {
      if (err.code === 'BULK_INVALID' && Array.isArray(err.details)) {
        setRowErrors(Object.fromEntries(err.details.map((d) => [d.id, d.message])));
      }
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const errorList = Object.entries(rowErrors);

  return (
    <>
      <PageHeader compact title={t('menu.bulkUpdate')} subtitle={t('bulk.subtitle')}
        actions={(
          <>
            {changedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setEdits({}); setOriginals({}); setRowErrors({}); }} disabled={saving}>
                {t('bulk.discard')}
              </Button>
            )}
            <Button size="sm" onClick={save} loading={saving} disabled={!changedCount}>
              <Icon name="check" size={15} /> {changedCount ? t('bulk.saveN', { n: changedCount }) : t('bulk.save')}
            </Button>
          </>
        )} />
      <Card className="crud-compact">
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('items.searchHint')} />
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t('items.category')}>
            <option value="">{t('items.allCategories')}</option>
            {(cats.data?.rows || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {changedCount > 0 && <span className="bulk-pending">{t('bulk.pending', { n: changedCount })}</span>}
        </div>
        {errorList.length > 0 && (
          <div className="alert alert-error">
            {errorList.map(([id, msg]) => <div key={id}><b>{originals[id]?.name || `#${id}`}</b>: {msg}</div>)}
          </div>
        )}
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (list.data.rows.length ? (
          <>
            <div className="table-wrap po-lines bulk-grid">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('items.code')}</th>
                    <th className="bulk-name">{t('items.name')}</th>
                    {FIELDS.map(([f, label]) => <th key={f}>{t(label)}</th>)}
                  </tr>
                </thead>
                <tbody onKeyDown={arrowMove}>
                  {list.data.rows.map((item) => (
                    <tr key={item.id} className={`${edits[item.id] ? 'bulk-changed' : ''} ${rowErrors[item.id] ? 'bulk-error' : ''}`}
                      title={rowErrors[item.id] || undefined}>
                      <td className="muted">{item.item_code}</td>
                      <td className="bulk-name"><b>{item.name}</b></td>
                      {FIELDS.map(([f, label, kind]) => {
                        const value = valueOf(item, f, kind);
                        const changed = edits[item.id] && f in edits[item.id];
                        const props = { 'aria-label': `${item.name} – ${t(label)}`, className: `bulk-${f} ${changed ? 'bulk-cell-changed' : ''}` };
                        return (
                          <td key={f}>
                            {kind === 'list' ? (
                              <select {...props} value={value} onChange={(e) => setValue(item, f, kind, e.target.value)}>
                                <option value="">—</option>
                                {choicesFor(f, value).map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            ) : kind === 'status' ? (
                              <select {...props} value={value} onChange={(e) => setValue(item, f, kind, e.target.value)}>
                                <option value="active">{t('status.active')}</option>
                                <option value="inactive">{t('status.inactive')}</option>
                              </select>
                            ) : (
                              <input {...props} type={kind === 'num' ? 'number' : 'text'} min={kind === 'num' ? '0' : undefined}
                                step={kind === 'num' ? '0.01' : undefined} inputMode={kind === 'num' ? 'decimal' : undefined}
                                value={value} onChange={(e) => setValue(item, f, kind, e.target.value)} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        ) : <Empty>{t('common.noRecords')}</Empty>)}
      </Card>
    </>
  );
}
