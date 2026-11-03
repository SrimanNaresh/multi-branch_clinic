// Pharmacy → Purchase / Order → Master: an order to a vendor. Picking an item fills its details, MRP and GST;
// Rate (P.Rate less Disc %), Amount, GST Amount and Total are worked out as you type (shared/purchase.js, same
// as the server). Old Price is this vendor's last net rate for the item; Free units are not charged.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, todayLocal } from '../../lib/format.js';
import { Button, Card, ErrorBox, Input, Loading, TextArea, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import ItemBulkPicker from '../../components/ItemBulkPicker.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';
import { calcLine, orderTotal, splitGst } from '../../../../shared/purchase.js';
import { arrowMove, focusNewRow } from '../../lib/tableKeys.js';

const newLine = () => ({
  key: Math.random().toString(36).slice(2), item_id: null, item_name: '',
  generic_name: '', hsn_code: '', manufacturer: '', category: '', pack: '', unit: '',
  mrp: '', p_rate: '', free_qty: '', disc_percent: '', qty: '', gst: undefined, cgst_percent: '', sgst_percent: '',
});
const fromItem = (i) => ({
  item_id: i.id, item_name: i.name, generic_name: i.generic_name || '', hsn_code: i.hsn_code || '',
  manufacturer: i.manufacturer || '', category: i.category || '', pack: i.pack || '', unit: i.unit || '',
  mrp: Number(i.mrp) || '', p_rate: Number(i.purchase_rate) || '', gst: undefined,
  cgst_percent: Number(i.cgst_percent) || '', sgst_percent: Number(i.sgst_percent) || '',
});
const overMrp = (l) => Number(l.mrp) > 0 && Number(l.p_rate) > Number(l.mrp);
const two = (n) => Number(n || 0).toFixed(2);

/** The vendor's details for the Details box: address, then State – Pin code, phones, e-mail, GSTIN, DL numbers. */
function vendorDetails(v, t) {
  if (!v) return '';
  const place = [v.state, v.pincode].filter(Boolean).join(' – ');
  const phones = [v.phone && `${t('suppliers.phone')}: ${v.phone}`, v.mobile && `${t('suppliers.mobile')}: ${v.mobile}`].filter(Boolean).join(', ');
  const dl = [v.dl_no1, v.dl_no2].filter(Boolean).join(', ');
  return [
    v.address, place, phones,
    v.email && `${t('field.email')}: ${v.email}`,
    v.gstin && `GSTIN: ${v.gstin}`,
    dl && `DL No: ${dl}`,
  ].filter(Boolean).join('\n');
}

export default function PurchaseForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const [head, setHead] = useState({ supplier_id: '', po_date: todayLocal(), details: '' });
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(false); // Details box: hidden until the arrow beside Vendor Name is clicked
  const [bulkOpen, setBulkOpen] = useState(false);   // "Bulk add" panel: tick many items at once
  const [showMore, setShowMore] = useState(false);   // Generic Name, Manufacturer, HSN in place of the GST columns
  const existing = useAsync(() => (id ? api(`/purchases/${id}`) : Promise.resolve(null)), [id]);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const [added, setAdded] = useState([]);           // vendors added here, until the list is loaded again
  const [newVendor, setNewVendor] = useState(null); // "+ Add vendor" form: { name, address, mobile }
  const [addingBusy, setAddingBusy] = useState(false);
  const vendorRows = [...added.filter((a) => !(vendors.data?.rows || []).some((v) => v.id === a.id)), ...(vendors.data?.rows || [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  const chooseVendor = (v) => setHead((h) => ({ ...h, supplier_id: String(v.id), details: vendorDetails(v, t) }));

  // New vendor from this screen: Name, Address and Mobile are all needed
  async function saveVendor() {
    const v = { name: newVendor.name.trim(), address: newVendor.address.trim(), mobile: newVendor.mobile.trim() };
    if (!v.name || !v.address || !v.mobile) { toast(t('purchase.vendorNeeds'), 'error'); return; }
    setAddingBusy(true);
    try {
      const saved = await api('/suppliers', { method: 'POST', body: { ...v, status: 'active' } });
      setAdded((a) => [...a, saved]);
      chooseVendor(saved);
      setNewVendor(null);
      toast(t('suppliers.saved', { name: saved.name }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAddingBusy(false);
    }
  }

  useEffect(() => {
    const po = existing.data;
    if (!po) return;
    setHead({ supplier_id: String(po.supplier_id), po_date: String(po.po_date).slice(0, 10), details: po.details || '' });
    setLines(po.lines.map((l) => ({ ...newLine(), ...l, key: String(l.id), mrp: Number(l.mrp), disc_percent: Number(l.disc_percent) || '',
      p_rate: Number(l.p_rate ?? l.mrp) || '', free_qty: Number(l.free_qty) || '',
      qty: Number(l.qty), cgst_percent: Number(l.cgst_percent) || '', sgst_percent: Number(l.sgst_percent) || '' })));
  }, [existing.data]);

  // Old Price: this vendor's last net rate for each item on the order (0 when never ordered from them)
  const itemIds = [...new Set(lines.filter((l) => l.item_id).map((l) => l.item_id))].sort((a, b) => a - b).join(',');
  const oldPrices = useAsync(
    () => (head.supplier_id && itemIds
      ? api('/purchases/old-prices', { query: { supplier_id: head.supplier_id, item_ids: itemIds, except: id || '' } })
      : Promise.resolve({})),
    [head.supplier_id, itemIds],
  );

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // + on a row adds a new empty line right under it
  const addLineAfter = (key) => setLines((ls) => ls.flatMap((l) => (l.key === key ? [l, newLine()] : [l])));
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));

  async function submit(e) {
    e.preventDefault();
    if (!head.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    const bad = lines.find((l) => l.item_id && overMrp(l));
    if (bad) { setError(t('purchase.rateOverMrp', { name: bad.item_name })); return; }
    setSaving(true);
    setError('');
    const body = {
      ...head,
      lines: lines.filter((l) => l.item_id).map(({ item_id, mrp, p_rate, free_qty, disc_percent, qty, cgst_percent, sgst_percent }) =>
        ({ item_id, mrp, p_rate, free_qty, disc_percent, qty, cgst_percent, sgst_percent })),
    };
    try {
      const po = id ? await api(`/purchases/${id}`, { method: 'PUT', body }) : await api('/purchases', { method: 'POST', body });
      toast(t('purchase.saved', { no: po.po_no }));
      if (id) navigate('/purchase');
      else { setHead({ supplier_id: '', po_date: todayLocal(), details: '' }); setLines([newLine()]); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const num = { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' };
  const picked = lines.filter((l) => l.item_id);

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="receipt" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.po_no}` : t('purchase.new')}</h1>
            <p className="muted">{t('purchase.hint')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/purchase')}><Icon name="list" size={15} /> {t('purchase.viewList')}</Button>
          </div>
        </div>

        <div className={`form-grid po-head ${showDetails ? '' : 'po-head-short'}`}>
          {/* picking a vendor puts its details into Details (still editable) */}
          <VendorPicker label={t('purchase.vendor')} required vendors={vendorRows} value={head.supplier_id}
            onPick={chooseVendor} onAdd={(name) => setNewVendor({ name, address: '', mobile: '' })}
            addon={(
              <button type="button" className={`po-more ${showDetails ? 'open' : ''}`} aria-expanded={showDetails}
                title={showDetails ? t('purchase.hideVendorDetails') : t('purchase.showVendorDetails')}
                aria-label={showDetails ? t('purchase.hideVendorDetails') : t('purchase.showVendorDetails')}
                onClick={() => setShowDetails(!showDetails)}>
                <Icon name={showDetails ? 'chevronLeft' : 'chevronRight'} size={15} />
              </button>
            )} />
          <Input label={t('purchase.date')} type="date" required value={head.po_date}
            onChange={(e) => setHead({ ...head, po_date: e.target.value })} />
          {showDetails && (
            <TextArea label={t('purchase.details')} full={false} rows={4} maxLength={1000} value={head.details}
              onChange={(e) => setHead({ ...head, details: e.target.value })} />
          )}
        </div>

        {newVendor && (
          <div className="po-new-vendor">
            <div className="po-new-vendor-title"><Icon name="truck" size={15} /> {t('suppliers.add')}</div>
            <div className="form-grid po-new-vendor-grid">
              <Input label={t('suppliers.name')} required autoFocus maxLength={150} value={newVendor.name}
                onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })} />
              <TextArea label={t('field.address')} required full={false} maxLength={500} value={newVendor.address}
                onChange={(e) => setNewVendor({ ...newVendor, address: e.target.value })} />
              <Input label={t('suppliers.mobile')} required type="tel" maxLength={20} value={newVendor.mobile}
                onChange={(e) => setNewVendor({ ...newVendor, mobile: e.target.value })} />
              <div className="po-new-vendor-actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => setNewVendor(null)} disabled={addingBusy}>{t('common.cancel')}</Button>
                <Button type="button" size="sm" onClick={saveVendor} loading={addingBusy}>{t('purchase.saveVendor')}</Button>
              </div>
            </div>
          </div>
        )}

        <div className="po-bulk-bar">
          <Button type="button" variant="ghost" size="sm" className={bulkOpen ? 'on' : ''} aria-expanded={bulkOpen} onClick={() => setBulkOpen(!bulkOpen)}>
            <Icon name="list" size={15} /> {t('bulkAdd.button')}
          </Button>
        </div>
        {bulkOpen && (
          <ItemBulkPicker exclude={lines.filter((l) => l.item_id).map((l) => l.item_id)} onClose={() => setBulkOpen(false)}
            onAdd={(items) => {
              // ticked items become rows (MRP / GST filled in), after the rows already chosen; empty rows go
              setLines((ls) => [...ls.filter((l) => l.item_id), ...items.map((i) => ({ ...newLine(), ...fromItem(i) }))]);
              toast(t('bulkAdd.added', { n: items.length }));
            }} />
        )}

        <div className="table-wrap po-lines po-fit">
          <table className="table">
            <colgroup>
              <col style={{ width: '2.5%' }} /><col style={{ width: '13.5%' }} /><col style={{ width: '6.5%' }} />
              <col style={{ width: '5%' }} /><col style={{ width: '4.5%' }} /><col style={{ width: '6%' }} />
              <col style={{ width: '5.5%' }} /><col style={{ width: '6%' }} /><col style={{ width: '4.5%' }} />
              <col style={{ width: '4.5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6.5%' }} />
              {showMore
                ? <><col style={{ width: '7.5%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '4%' }} /></>
                : <><col style={{ width: '4.5%' }} /><col style={{ width: '4.5%' }} /><col style={{ width: '4.5%' }} /><col style={{ width: '5.5%' }} /></>}
              <col style={{ width: '6.5%' }} /><col style={{ width: '4.5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th className="po-item">
                  <span className="po-item-head">
                    <span>{t('items.name')}</span>
                    <button type="button" className={`po-more ${showMore ? 'open' : ''}`} aria-expanded={showMore}
                      title={showMore ? t('purchase.hideDetails') : t('purchase.showDetails')}
                      aria-label={showMore ? t('purchase.hideDetails') : t('purchase.showDetails')}
                      onClick={() => setShowMore(!showMore)}>
                      <Icon name={showMore ? 'chevronLeft' : 'chevronRight'} size={15} />
                    </button>
                  </span>
                </th>
                <th>{t('items.category')}</th>
                <th>{t('items.pack')}</th>
                <th>{t('purchase.unit')}</th>
                <th className="num">{t('items.mrp')}</th>
                <th className="num">{t('purchase.oldPrice')}</th>
                <th className="num">{t('purchase.pRate')}</th>
                <th className="num">{t('purchase.free')}</th>
                <th className="num">{t('purchase.disc')}</th>
                <th className="num">{t('items.quantity')}</th>
                <th className="num">{t('purchase.amount')}</th>
                {showMore ? (
                  <>
                    <th className="po-extra">{t('items.generic')}</th>
                    <th className="po-extra">{t('items.manufacturer')}</th>
                    <th className="po-extra">{t('items.hsn')}</th>
                  </>
                ) : (
                  <>
                    <th className="num">{t('purchase.gst')}</th>
                    <th className="num">{t('items.cgst')}</th>
                    <th className="num">{t('items.sgst')}</th>
                    <th className="num">{t('purchase.gstAmount')}</th>
                  </>
                )}
                <th className="num">{t('purchase.total')}</th>
                <th aria-label={t('common.delete')} />
              </tr>
            </thead>
            <tbody onKeyDown={arrowMove}>
              {lines.map((l, n) => {
                const c = calcLine(l);
                const old = l.item_id && head.supplier_id ? Number(oldPrices.data?.[l.item_id] || 0) : null;
                return (
                  <tr key={l.key}>
                    <td className="muted">{n + 1}</td>
                    <td className="po-item">
                      <ItemPicker browse value={l.item_name} ariaLabel={t('items.name')} placeholder={t('purchase.itemHint')}
                        onPick={({ item, medicine_name: typed }) => setLine(l.key, item ? fromItem(item) : { ...newLine(), key: l.key, item_name: typed })} />
                    </td>
                    <td className="po-wrap">{l.category || '—'}</td>
                    <td className="po-wrap">{l.pack || '—'}</td>
                    <td className="po-wrap">{l.unit || '—'}</td>
                    <td><input {...num} aria-label={t('items.mrp')} value={l.mrp} onChange={(e) => setLine(l.key, { mrp: e.target.value })} /></td>
                    <td className="num muted">{old == null ? '—' : two(old)}</td>
                    <td className={overMrp(l) ? 'cell-bad' : undefined} title={overMrp(l) ? t('purchase.rateOverMrp', { name: l.item_name }) : undefined}>
                      <input {...num} aria-label={t('purchase.pRate')} value={l.p_rate} onChange={(e) => setLine(l.key, { p_rate: e.target.value })} />
                    </td>
                    <td><input {...num} aria-label={t('purchase.free')} value={l.free_qty} onChange={(e) => setLine(l.key, { free_qty: e.target.value })} /></td>
                    <td><input {...num} max="100" aria-label={t('purchase.disc')} value={l.disc_percent} onChange={(e) => setLine(l.key, { disc_percent: e.target.value })} /></td>
                    <td><input {...num} aria-label={t('items.quantity')} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                    <td className="num">{two(c.amount)}</td>
                    {showMore ? (
                      <>
                        <td className="po-extra po-wrap">{l.generic_name || '—'}</td>
                        <td className="po-extra po-wrap">{l.manufacturer || '—'}</td>
                        <td className="po-extra po-wrap">{l.hsn_code || '—'}</td>
                      </>
                    ) : (
                      <>
                        {/* GST % splits itself evenly into CGST % and SGST % */}
                        <td><input {...num} max="28" aria-label={t('purchase.gst')} value={l.gst ?? (c.gst_percent || '')}
                          onChange={(e) => setLine(l.key, { gst: e.target.value, ...splitGst(e.target.value) })} /></td>
                        <td><input {...num} max="14" aria-label={t('items.cgst')} value={l.cgst_percent}
                          onChange={(e) => setLine(l.key, { cgst_percent: e.target.value, gst: undefined })} /></td>
                        <td><input {...num} max="14" aria-label={t('items.sgst')} value={l.sgst_percent}
                          onChange={(e) => setLine(l.key, { sgst_percent: e.target.value, gst: undefined })} /></td>
                        <td className="num">{two(c.gst_amount)}</td>
                      </>
                    )}
                    <td className="num"><b>{two(c.total)}</b></td>
                    <td>
                      <span className="po-row-actions">
                        <button type="button" className="icon-btn rx-add" title={t('purchase.addLine')} aria-label={t('purchase.addLine')} onClick={(e) => { addLineAfter(l.key); focusNewRow(e.currentTarget); }}>
                          <Icon name="plus" size={16} />
                        </button>
                        <button type="button" className="icon-btn" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => removeLine(l.key)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showMore ? 15 : 16} className="num"><b>{t('purchase.sumTotal')}</b></td>
                <td className="num po-sum">{money(orderTotal(picked))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/purchase')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving}>{id ? t('common.save') : <><Icon name="plus" size={16} /> {t('purchase.save')}</>}</Button>
        </div>
      </Card>
    </form>
  );
}
