// Pharmacy → Item: add / edit a medicine or item
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, PageHeader, Select, useAsync, useForm, useToast } from '../../components/ui.jsx';

export const UNITS = ['nos', 'bottle', 'strip', 'tablet', 'ml', 'gm', 'dram', 'box', 'tube', 'sachet'];
export const CATEGORIES = ['Dilution', 'Mother Tincture', 'Biochemic', 'Tablet', 'Syrup', 'Ointment', 'Drops', 'Globules', 'Combination', 'Other'];

export default function ItemForm({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const id = params.id;
  const f = useForm({ name: '', category: '', unit: 'nos', price: '', gst_percent: '0', reorder_level: '0', opening_stock: '', pharmacy_id: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/items/${id}`) : Promise.resolve(null)), [id]);
  const pharmacies = useAsync(() => api('/pharmacies', { query: { clinic_id: auth.activeClinicId, status: 'active' } }), []);
  const cats = useAsync(() => api('/items/categories'), []);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    f.setValues((v) => ({ ...v, ...Object.fromEntries(Object.keys(v).map((k) => [k, e[k] ?? v[k]])), pharmacy_id: e.pharmacy_id ? String(e.pharmacy_id) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { ...f.values };
    if (id) delete body.opening_stock;
    try {
      const item = id ? await api(`/items/${id}`, { method: 'PUT', body }) : await api('/items', { method: 'POST', body });
      toast(t('items.saved', { name: item.name }));
      if (id) navigate('/items');
      else f.setValues((v) => ({ ...v, name: '', price: '', opening_stock: '' }));   // ready for the next item
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const allCats = [...new Set([...CATEGORIES, ...(cats.data?.rows || [])])];

  return (
    <>
      <PageHeader title={id ? `${t('common.edit')} – ${existing.data?.name}` : t('menu.item')} subtitle={t('items.subtitle')}
        actions={<Button variant="ghost" onClick={() => navigate('/items')}>{t('menu.itemList')}</Button>} />
      <form onSubmit={submit}>
        <Card>
          <div className="form-grid">
            <Input label={t('items.name')} required {...f.bind('name')} autoFocus />
            <Field2 label={t('items.category')}>
              <input list="item-cats" {...f.bind('category')} />
              <datalist id="item-cats">{allCats.map((c) => <option key={c} value={c} />)}</datalist>
            </Field2>
            <Select label={t('items.unit')} {...f.bind('unit')} options={UNITS.map((u) => ({ value: u, label: u }))} />
            <Input label={t('items.price')} type="number" min="0" step="0.01" required {...f.bind('price')} hint={t('items.priceHint')} />
            <Input label={t('items.gst')} type="number" min="0" max="28" step="0.01" {...f.bind('gst_percent')} />
            <Input label={t('items.reorder')} type="number" min="0" step="0.01" {...f.bind('reorder_level')} />
            {!id && <Input label={t('items.openingStock')} type="number" min="0" step="0.01" {...f.bind('opening_stock')} />}
            {id && <Input label={t('items.stock')} value={`${existing.data.stock_qty} ${existing.data.unit}`} disabled hint={t('items.stockHint')} />}
            {pharmacies.data?.rows?.length > 0 && (
              <Select label={t('unit.pharmacy')} {...f.bind('pharmacy_id')} placeholder="—"
                options={pharmacies.data.rows.map((p) => ({ value: String(p.id), label: p.name }))} />
            )}
            {id && (
              <Select label={t('field.status')} {...f.bind('status')}
                options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
            )}
          </div>
        </Card>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={() => navigate('/items')}>{t('common.cancel')}</Button>
          <Button type="submit" loading={saving}>{t('common.save')}</Button>
        </div>
      </form>
    </>
  );
}

function Field2({ label, children }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}
