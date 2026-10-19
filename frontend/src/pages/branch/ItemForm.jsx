// Pharmacy → Item: add / edit a medicine or item
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, useAsync, useForm, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemImportButtons from '../../components/ItemImport.jsx';

export const UNITS = ['nos', 'bottle', 'strip', 'tablet', 'ml', 'gm', 'dram', 'box', 'tube', 'sachet'];
export const CATEGORIES = ['Dilution', 'Mother Tincture', 'Biochemic', 'Tablet', 'Syrup', 'Ointment', 'Drops', 'Globules', 'Combination', 'Other'];
const ITEM_TYPES = ['Medicine', 'Consumable', 'Equipment', 'Other'];

const EMPTY = {
  name: '', item_type: '', category: '', hsn_code: '',
  manufacturer: '', supplier_name: '', generic_name: '', brand_name: '', unit: '',
  purchase_rate: '', gst_percent: '', mrp: '', price: '', discount_percent: '',
  schedule_h: false, schedule_h1: false, status: 'active',
};
const uniq = (...lists) => [...new Set(lists.flat().filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** "Select or add": pick a value already used, or type a new one. */
function ComboField({ id, label, placeholder, options, ...input }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="combo-input" list={id} placeholder={placeholder} autoComplete="off" {...input} />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </label>
  );
}

export default function ItemForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const f = useForm(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/items/${id}`) : Promise.resolve(null)), [id]);
  const opts = useAsync(() => api('/items/options'), []);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    f.setValues({
      ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, e[k] ?? EMPTY[k]])),
      supplier_name: e.supplier_name || '', schedule_h: !!e.schedule_h, schedule_h1: !!e.schedule_h1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const v = f.values;
    const num = (x) => (x === '' || x == null ? 0 : x);
    const body = {
      ...v,
      unit: v.unit || 'nos',
      purchase_rate: num(v.purchase_rate), gst_percent: num(v.gst_percent), mrp: num(v.mrp),
      price: num(v.price), discount_percent: num(v.discount_percent),
    };
    if (!id) delete body.status;
    try {
      const item = id ? await api(`/items/${id}`, { method: 'PUT', body }) : await api('/items', { method: 'POST', body });
      toast(t('items.saved', { name: item.name }));
      opts.reload();
      if (id) navigate('/items');
      else f.setValues(EMPTY);   // ready for the next item
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const o = opts.data || {};
  const money = { type: 'number', min: '0', step: '0.01', placeholder: '0.00', inputMode: 'decimal' };

  return (
    <>
      <form onSubmit={submit}>
        <Card className="item-card">
          {/* compact header inside the card (no tall page header) */}
          <div className="compact-head">
            <span className="compact-head-icon"><Icon name="box" size={16} /></span>
            <div>
              <h1>{id ? `${t('common.edit')} – ${existing.data?.name}` : t('items.addItem')}</h1>
              <p className="muted">{id ? existing.data?.category || t('items.subtitle') : t('items.registerHint')}</p>
            </div>
            <div className="compact-head-actions">
              {!id && <ItemImportButtons onImported={opts.reload} />}
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/items')}><Icon name="list" size={15} /> {t('items.viewList')}</Button>
            </div>
          </div>
          <div className="form-grid item-grid">
            <Input label={t('items.name')} required placeholder={t('items.namePh')} autoFocus {...f.bind('name')} />
            <ComboField id="item-types" label={t('items.type')} placeholder={t('items.typePh')}
              options={uniq(ITEM_TYPES, o.types || [])} {...f.bind('item_type')} />
            <ComboField id="item-cats" label={t('items.category')} placeholder={t('items.categoryPh')}
              options={uniq(CATEGORIES, o.categories || [])} {...f.bind('category')} />
            <Input label={t('items.hsn')} placeholder={t('items.hsnPh')} maxLength={20} {...f.bind('hsn_code')} />
            <span className="grid-break" aria-hidden />

            <ComboField id="item-mfrs" label={t('items.manufacturer')} placeholder={t('items.manufacturerPh')}
              options={o.manufacturers || []} {...f.bind('manufacturer')} />
            <ComboField id="item-suppliers" label={t('items.supplier')} placeholder={t('items.supplierPh')}
              options={(o.suppliers || []).map((s) => s.name)} {...f.bind('supplier_name')} />
            <ComboField id="item-generics" label={t('items.generic')} placeholder={t('items.genericPh')}
              options={o.generics || []} {...f.bind('generic_name')} />
            <Input label={t('items.brand')} placeholder={t('items.brandPh')} {...f.bind('brand_name')} />
            <ComboField id="item-units" label={t('items.unit')} placeholder={t('items.unitPh')}
              options={uniq(UNITS, o.units || [])} {...f.bind('unit')} />

            <Input label={t('items.purchaseRate')} {...money} {...f.bind('purchase_rate')} />
            <Input label={t('items.gst')} {...money} max="28" {...f.bind('gst_percent')} />
            <Input label={t('items.mrp')} {...money} {...f.bind('mrp')} />
            <Input label={t('items.sellPrice')} {...money} {...f.bind('price')} />
            <Input label={t('items.discount')} {...money} max="100" {...f.bind('discount_percent')} />

            <div className="field-full item-checks">
              <label className="check"><input type="checkbox" checked={f.values.schedule_h} onChange={(e) => f.set('schedule_h', e.target.checked)} /> {t('items.scheduleH')}</label>
              <label className="check"><input type="checkbox" checked={f.values.schedule_h1} onChange={(e) => f.set('schedule_h1', e.target.checked)} /> {t('items.scheduleH1')}</label>
              {id && (
                <label className="inline-field item-status">
                  {t('field.status')}
                  <select {...f.bind('status')}>
                    <option value="active">{t('status.active')}</option>
                    <option value="inactive">{t('status.inactive')}</option>
                  </select>
                </label>
              )}
            </div>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions item-actions">
            {id && <Button type="button" variant="ghost" onClick={() => navigate('/items')}>{t('common.cancel')}</Button>}
            <Button type="submit" loading={saving}>
              {id ? t('common.save') : <><Icon name="plus" size={16} /> {t('items.addItem')}</>}
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
