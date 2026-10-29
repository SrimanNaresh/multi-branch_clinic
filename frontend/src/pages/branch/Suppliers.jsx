// Pharmacy → Vendor → List (add / edit open the Vendor screen, VendorForm.jsx)
import { useT } from '../../lib/i18n.jsx';
import CrudPage, { statusColumn } from '../../components/CrudPage.jsx';

export default function SuppliersPage() {
  const { t } = useT();
  return (
    <CrudPage
      title={t('menu.vendor')}
      subtitle={t('suppliers.subtitle')}
      endpoint="/suppliers"
      compact
      addLabel={t('suppliers.add')}
      addPath="/suppliers/new"
      editPath={(r) => `/suppliers/${r.id}/edit`}
      fields={[]}
      columns={[
        { key: 'name', label: t('suppliers.name'), render: (r) => <b>{r.name}</b> },
        { key: 'contact_person', label: t('suppliers.contact') },
        { key: 'mobile', label: t('suppliers.mobile') },
        { key: 'state', label: t('suppliers.state') },
        { key: 'gstin', label: 'GSTIN' },
        statusColumn(t),
      ]}
    />
  );
}
