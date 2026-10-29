// Pharmacy → Item: add / edit a medicine or item
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, Select, useAsync, useForm, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import ItemImportButtons from '../../components/ItemImport.jsx';
import RxListPicker from '../../components/RxListPicker.jsx';

// Only these fields are on the screen; anything else on an existing item (category, supplier,
// purchase rate, …) is not sent, so saving keeps its current value.
const EMPTY = {
  name: '', generic_name: '', hsn_code: '', manufacturer: '', unit: '', pack: '', category: '', potency: '',
  mrp: '', cgst_percent: '', sgst_percent: '',
  schedule_h: false, schedule_h1: false, status: 'active', rack: '', box: '',
};
/** The clinic's Generic Name / Manufacturer / Type / Unit / Category / Potency list (+ New, Edit, Delete), replaced locally after a change. */
function useItemList(kind) {
  const loaded = useAsync(() => api(`/visits/${kind}-options`), [kind]);
  const [changed, setChanged] = useState(null);
  return [changed || loaded.data || { rows: [], added: [] }, setChanged];
}

export default function ItemForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const f = useForm(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [qty, setQty] = useState('');            // Quantity: opening stock when adding, current stock when editing
  const existing = useAsync(() => (id ? api(`/items/${id}`) : Promise.resolve(null)), [id]);
  const [genericList, setGenericList] = useItemList('generic');
  const [mfrList, setMfrList] = useItemList('manufacturer');
  const [unitList, setUnitList] = useItemList('unit');
  const [categoryList, setCategoryList] = useItemList('category');
  const [potencyList, setPotencyList] = useItemList('itempotency');

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    f.setValues({
      ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, e[k] ?? EMPTY[k]])),
      schedule_h: !!e.schedule_h, schedule_h1: !!e.schedule_h1,
    });
    setQty(String(Number(e.stock_qty ?? 0)));
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
      cgst_percent: num(v.cgst_percent), sgst_percent: num(v.sgst_percent),
      // no separate sell price on the screen: dispense bills at MRP
      mrp: num(v.mrp), price: num(v.mrp),
    };
    if (id) body.stock_qty = num(qty);
    else body.opening_stock = num(qty);
    try {
      const item = id ? await api(`/items/${id}`, { method: 'PUT', body }) : await api('/items', { method: 'POST', body });
      toast(t('items.saved', { name: item.name }));
      if (id) navigate('/items');
      else { f.setValues(EMPTY); setQty(''); }   // ready for the next item
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
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
              <p className="muted">
                {id ? [existing.data?.item_code, existing.data?.category].filter(Boolean).join(' · ') || t('items.subtitle') : t('items.registerHint')}
              </p>
            </div>
            <div className="compact-head-actions">
              {!id && <ItemImportButtons />}
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/items')}><Icon name="list" size={15} /> {t('items.viewList')}</Button>
            </div>
          </div>
          <div className="form-grid item-grid">
            <Input label={t('items.name')} required placeholder={t('items.namePh')} autoFocus {...f.bind('name')} />
            <div className="field">
              <span className="field-label">{t('items.typeUnit')}</span>
              <RxListPicker kind="unit" label={t('items.typeUnit')} value={f.values.unit} list={unitList}
                onChange={(v) => f.set('unit', v)} onListChange={setUnitList} />
            </div>
            <Input label={t('items.hsn')} placeholder={t('items.hsnPh')} maxLength={20} {...f.bind('hsn_code')} />
            <Input label={t('items.pack')} placeholder={t('items.packPh')} {...f.bind('pack')} />
            <Input label={t('items.quantity')} type="number" min="0" step="0.01" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input label={t('items.mrp')} {...money} {...f.bind('mrp')} />
            <Input label={t('items.cgst')} {...money} max="14" {...f.bind('cgst_percent')} />
            <Input label={t('items.sgst')} {...money} max="14" {...f.bind('sgst_percent')} />
            <Input label={t('items.rack')} placeholder={t('items.rackPh')} {...f.bind('rack')} />
            <Input label={t('items.box')} placeholder={t('items.boxPh')} {...f.bind('box')} />
            <span className="grid-break" aria-hidden />

            <div className="field">
              <span className="field-label">{t('items.generic')}</span>
              <RxListPicker kind="generic" label={t('items.generic')} value={f.values.generic_name} list={genericList}
                onChange={(v) => f.set('generic_name', v)} onListChange={setGenericList} />
            </div>
            <div className="field">
              <span className="field-label">{t('items.manufacturer')}</span>
              <RxListPicker kind="manufacturer" label={t('items.manufacturer')} value={f.values.manufacturer} list={mfrList}
                onChange={(v) => f.set('manufacturer', v)} onListChange={setMfrList} />
            </div>
            <div className="field">
              <span className="field-label">{t('items.category')}</span>
              <RxListPicker kind="category" label={t('items.category')} value={f.values.category} list={categoryList}
                onChange={(v) => f.set('category', v)} onListChange={setCategoryList} />
            </div>
            <div className="field">
              <span className="field-label">{t('items.potency')}</span>
              <RxListPicker kind="itempotency" label={t('items.potency')} value={f.values.potency} list={potencyList}
                onChange={(v) => f.set('potency', v)} onListChange={setPotencyList} />
            </div>
            {/* one Schedule choice, stored as the two schedule_h / schedule_h1 flags */}
            <Select label={t('items.schedule')} value={f.values.schedule_h1 ? 'H1' : f.values.schedule_h ? 'H' : ''}
              onChange={(e) => f.setValues({ ...f.values, schedule_h: e.target.value === 'H', schedule_h1: e.target.value === 'H1' })}
              options={[{ value: '', label: t('items.scheduleNone') }, { value: 'H', label: 'H' }, { value: 'H1', label: 'H1' }]} />
            <Select label={t('field.status')} {...f.bind('status')}
              options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
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
