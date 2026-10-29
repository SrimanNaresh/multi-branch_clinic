// "Bulk add" panel (Pharmacy → Purchase / Order): search / filter the Item List, tick many items, then Add –
// onAdd(items) gets the ticked items. Shown on the page under its button (no pop-up).
// `exclude`: item ids already in the table – shown ticked and greyed, not added again.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import { Button, Loading, SearchBox, useAsync, useDebounced } from './ui.jsx';
import Icon from './Icon.jsx';

export default function ItemBulkPicker({ onAdd, onClose, exclude = [] }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [picked, setPicked] = useState(() => new Map());   // id → item
  const dq = useDebounced(q);
  const list = useAsync(
    () => api('/items', { query: { q: dq, category, manufacturer, status: 'active', limit: 100 } }),
    [dq, category, manufacturer],
  );
  const opts = useAsync(() => api('/items/options'), []);
  const taken = new Set(exclude.map(Number));
  const rows = list.data?.rows || [];
  const free = rows.filter((i) => !taken.has(i.id));
  const allShownPicked = free.length > 0 && free.every((i) => picked.has(i.id));

  const toggle = (item) => setPicked((m) => {
    const next = new Map(m);
    if (next.has(item.id)) next.delete(item.id); else next.set(item.id, item);
    return next;
  });
  const toggleAll = () => setPicked((m) => {
    const next = new Map(m);
    free.forEach((i) => (allShownPicked ? next.delete(i.id) : next.set(i.id, i)));
    return next;
  });

  return (
    <div className="bulk-pick">
      <div className="bulk-pick-head">
        <b><Icon name="list" size={15} /> {t('bulkAdd.title')}</b>
        <span className="muted">{t('bulkAdd.hint')}</span>
        <button type="button" className="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('items.searchHint')} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('items.category')}>
          <option value="">{t('items.allCategories')}</option>
          {(opts.data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} aria-label={t('items.manufacturer')}>
          <option value="">{t('bulkAdd.allManufacturers')}</option>
          {(opts.data?.manufacturers || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : (
        <div className="bulk-pick-list">
          <label className="bulk-pick-row bulk-pick-all">
            <input type="checkbox" checked={allShownPicked} disabled={!free.length} onChange={toggleAll} />
            <span>{t('bulkAdd.selectShown', { n: free.length })}{list.data?.total > rows.length ? ` · ${t('bulkAdd.narrow', { n: list.data.total })}` : ''}</span>
          </label>
          {rows.map((i) => {
            const already = taken.has(i.id);
            return (
              <label key={i.id} className={`bulk-pick-row ${already ? 'taken' : ''}`}>
                <input type="checkbox" checked={already || picked.has(i.id)} disabled={already} onChange={() => toggle(i)} />
                <span className="bulk-pick-name"><b>{i.name}</b>{i.generic_name && <small className="muted"> · {i.generic_name}</small>}</span>
                <span className="muted">{[i.category, i.manufacturer, i.pack].filter(Boolean).join(' · ')}</span>
                {already && <span className="muted bulk-pick-in">{t('bulkAdd.inTable')}</span>}
              </label>
            );
          })}
          {!rows.length && <p className="muted bulk-pick-none">{t('common.noRecords')}</p>}
        </div>
      )}
      <div className="bulk-pick-foot">
        <span className="muted">{t('bulkAdd.ticked', { n: picked.size })}</span>
        {picked.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Map())}>{t('bulkAdd.clear')}</Button>}
        <Button type="button" size="sm" disabled={!picked.size} onClick={() => { onAdd([...picked.values()]); setPicked(new Map()); }}>
          <Icon name="plus" size={15} /> {t('bulkAdd.add', { n: picked.size })}
        </Button>
      </div>
    </div>
  );
}
