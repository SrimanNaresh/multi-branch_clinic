import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel } from '../../lib/format.js';
import { Button, Card, DataTable, ErrorBox, Loading, Modal, PageHeader, Pagination, SearchBox, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import Icon, { PatientCardIcon } from '../../components/Icon.jsx';

export default function PatientList({ query }) {
  const { t } = useT();
  const auth = useAuth();
  const [q, setQ] = useState(query.q || '');
  const [page, setPage] = useState(1);
  const [card, setCard] = useState(null);
  const dq = useDebounced(q);
  const list = useAsync(() => api('/patients', { query: { q: dq, page } }), [dq, page]);

  // Print only the open Patient card (styles: body.printing-card in styles.css)
  function printCard() {
    document.body.classList.add('printing-card');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-card'), { once: true });
    window.print();
  }

  const columns = [
    { key: 'patient_code', label: t('field.patientId'), render: (r) => <b>{r.patient_code}</b> },
    { key: 'name', label: t('field.name') },
    { key: 'gender', label: t('field.genderAge'), render: (r) => `${genderLabel(r.gender, t)} / ${ageLabel(r)}` },
    { key: 'mobile', label: t('field.mobile') },
    { key: 'city', label: t('field.city') },
    { key: 'created_at', label: t('patients.registeredOn'), render: (r) => fmtDate(r.created_at) },
    { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: '_card', label: t('patients.card'), className: 'col-center',
      render: (r) => (
        <button type="button" className="icon-btn img-btn" title={t('patients.card')} aria-label={t('patients.card')}
          onClick={(e) => { e.stopPropagation(); setCard(r); }}>
          <PatientCardIcon />
        </button>
      ),
    },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.id}`); }}><Icon name="eye" size={15} /> {t('common.view')}</Button>
          {auth.can('patient.edit') && (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.id}/edit`); }}><Icon name="edit" size={15} /> {t('common.edit')}</Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('menu.patientList')}
        subtitle={list.data ? t('patients.count', { n: list.data.total }) : auth.activeClinic?.name}
        actions={auth.can('patient.create') && <Button onClick={() => navigate('/patients/new')}><Icon name="plus" size={16} /> {t('menu.patientRegistration')}</Button>}
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('patients.searchHint')} autoFocus />
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} onRowClick={(r) => navigate(`/patients/${r.id}`)} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {card && (
        <Modal title={t('patients.card')} onClose={() => setCard(null)}
          footer={<Button onClick={printCard}><Icon name="print" size={16} /> {t('billing.print')}</Button>}>
          <div className="patient-card">
            <dl>
              <dt>{t('field.patientId')}</dt><dd><b>{card.patient_code}</b></dd>
              <dt>{t('field.name')}</dt><dd>{card.name}</dd>
              <dt>{t('field.age')}</dt><dd>{ageLabel(card) || '—'}</dd>
              <dt>{t('field.gender')}</dt><dd>{card.gender ? genderLabel(card.gender, t) : '—'}</dd>
            </dl>
            <dl>
              <dt>{t('field.address')}</dt><dd className="pre-line">{card.address || '—'}</dd>
              <dt>{t('field.mobile')}</dt><dd>{card.mobile || '—'}</dd>
            </dl>
          </div>
        </Modal>
      )}
    </>
  );
}
