import { useT } from '../../lib/i18n.jsx';
import CrudPage, { statusColumn } from '../../components/CrudPage.jsx';

export default function SuppliersPage() {
  const { t } = useT();
  return (
    <CrudPage
      title={t('menu.supplier')}
      subtitle={t('suppliers.subtitle')}
      endpoint="/suppliers"
      addLabel={t('suppliers.add')}
      fields={[
        { name: 'name', label: t('suppliers.name'), required: true },
        { name: 'contact_person', label: t('suppliers.contact') },
        { name: 'mobile', label: t('field.mobile'), type: 'tel' },
        { name: 'email', label: t('field.email'), type: 'email' },
        { name: 'gstin', label: 'GSTIN', upper: true, maxLength: 15 },
        { name: 'address', label: t('field.address'), type: 'textarea', full: true },
      ]}
      columns={[
        { key: 'name', label: t('suppliers.name'), render: (r) => <b>{r.name}</b> },
        { key: 'contact_person', label: t('suppliers.contact') },
        { key: 'mobile', label: t('field.mobile') },
        { key: 'gstin', label: 'GSTIN' },
        statusColumn(t),
      ]}
    />
  );
}
