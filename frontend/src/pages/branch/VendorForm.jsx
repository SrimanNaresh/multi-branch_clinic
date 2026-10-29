// Pharmacy → Vendor → Master: add / edit a vendor on its own screen
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { Button, Card, ErrorBox, Input, Loading, Select, TextArea, useAsync, useForm, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

// Indian states and union territories, for the State drop-down
const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
].map((s) => ({ value: s, label: s }));

const EMPTY = {
  name: '', contact_person: '', address: '', state: '', pincode: '', phone: '', mobile: '', email: '',
  gstin: '', dl_no1: '', dl_no2: '', status: 'active',
};
const UPPER = ['gstin', 'dl_no1', 'dl_no2'];

export default function VendorForm({ params }) {
  const { t } = useT();
  const toast = useToast();
  const id = params.id;
  const f = useForm(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const existing = useAsync(() => (id ? api(`/suppliers/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const e = existing.data;
    if (e) f.setValues(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, e[k] ?? EMPTY[k]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { ...f.values };
    for (const k of UPPER) if (body[k]) body[k] = String(body[k]).toUpperCase();
    try {
      const v = id ? await api(`/suppliers/${id}`, { method: 'PUT', body }) : await api('/suppliers', { method: 'POST', body });
      toast(t('suppliers.saved', { name: v.name }));
      if (id) navigate('/suppliers');
      else f.setValues(EMPTY);                       // ready for the next vendor
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const upper = { style: { textTransform: 'uppercase' } };

  return (
    <form onSubmit={submit}>
      <Card className="item-card">
        <div className="compact-head">
          <span className="compact-head-icon"><Icon name="truck" size={16} /></span>
          <div>
            <h1>{id ? `${t('common.edit')} – ${existing.data?.name}` : t('suppliers.add')}</h1>
            <p className="muted">{t('suppliers.subtitle')}</p>
          </div>
          <div className="compact-head-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/suppliers')}><Icon name="list" size={15} /> {t('suppliers.viewList')}</Button>
          </div>
        </div>
        <div className="form-grid vendor-grid">
          <Input label={t('suppliers.name')} required autoFocus maxLength={150} {...f.bind('name')} />
          <Input label={t('suppliers.contact')} maxLength={150} {...f.bind('contact_person')} />
          <TextArea label={t('field.address')} required full={false} maxLength={500} {...f.bind('address')} />
          <Input label={t('field.email')} type="email" maxLength={150} {...f.bind('email')} />
          <Select label={t('suppliers.state')} placeholder="—" options={STATES} {...f.bind('state')} />
          <Input label={t('suppliers.pincode')} inputMode="numeric" maxLength={6} pattern="\d{6}" {...f.bind('pincode')} />
          <Input label={t('suppliers.phone')} type="tel" maxLength={20} {...f.bind('phone')} />
          <Input label={t('suppliers.mobile')} required type="tel" maxLength={20} {...f.bind('mobile')} />
          <Input label="GSTIN" maxLength={15} {...upper} {...f.bind('gstin')} />
          <Input label={t('suppliers.dl1')} maxLength={50} {...upper} {...f.bind('dl_no1')} />
          <Input label={t('suppliers.dl2')} maxLength={50} {...upper} {...f.bind('dl_no2')} />
          <Select label={t('field.status')} {...f.bind('status')}
            options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions item-actions">
          {id && <Button type="button" variant="ghost" onClick={() => navigate('/suppliers')}>{t('common.cancel')}</Button>}
          <Button type="submit" loading={saving}>
            {id ? t('common.save') : <><Icon name="plus" size={16} /> {t('suppliers.add')}</>}
          </Button>
        </div>
      </Card>
    </form>
  );
}
