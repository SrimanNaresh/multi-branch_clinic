// Billing → Patient Bill: consultation + issued pharmacy items (+ extra lines) → bill → print/PDF
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { money, todayLocal } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Input, Loading, Modal, PageHeader, Select, useAsync, useToast } from '../../components/ui.jsx';
import Icon, { UploadIcon } from '../../components/Icon.jsx';
import Attachments from '../../components/Attachments.jsx';

function Pending() {
  const { t } = useT();
  const [date, setDate] = useState(todayLocal());
  const list = useAsync(() => api('/bills/pending', { query: { date } }), [date]);
  const [attachFor, setAttachFor] = useState(null);   // row whose Lab Reports & Scans pop-up is open
  const columns = [
    { key: 'token_no', label: t('queue.token'), render: (r) => <span className="token-chip">#{r.token_no ?? '—'}</span> },
    { key: 'patient_name', label: t('field.name'), render: (r) => <><b>{r.patient_name}</b><br /><span className="muted small">{r.patient_code}</span></> },
    { key: 'mobile', label: t('field.mobile') },
    { key: 'consultation_fee', label: t('field.consultationFee'), render: (r) => money(r.consultation_fee), className: 'num' },
    { key: 'unbilled_items', label: t('billing.medicines'), render: (r) => money(r.unbilled_items), className: 'num' },
    { key: 'bill_count', label: '', render: (r) => (r.bill_count > 0 ? <Badge tone="info">{t('billing.partBilled')}</Badge> : null) },
    { key: 'reports', label: t('billing.reports'), className: 'col-center', render: (r) => r.queue_id && (
      // same Lab Reports & Scans upload as in the Vital signs pop-up; green tick once a file is there
      <button type="button" className="icon-btn img-btn attach-btn"
        title={r.attach_count > 0 ? t('billing.viewReports', { n: r.attach_count }) : t('billing.uploadReports')}
        aria-label={t('billing.uploadReports')} onClick={() => setAttachFor(r)}>
        <UploadIcon />
        {r.attach_count > 0 && <span className="vitals-badge done"><Icon name="check" size={11} /></span>}
      </button>
    ) },
    { key: '_a', label: '', className: 'col-actions', render: (r) => <Button size="sm" onClick={() => navigate(`/billing/${r.visit_id}`)}>{t('billing.makeBill')}</Button> },
  ];
  return (
    <>
      <PageHeader title={t('menu.patientBill')} subtitle={t('billing.subtitle')}
        actions={(
          <>
            <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} aria-label={t('field.date')} />
            <Button variant="ghost" onClick={() => navigate('/bills')}>{t('menu.billList')}</Button>
          </>
        )} />
      <Card>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && <DataTable columns={columns} rows={list.data.rows} rowKey="visit_id" empty={t('billing.nonePending')} />}
      </Card>
      {attachFor && (
        <Modal title={`${t('attach.title')} – #${attachFor.token_no ?? '—'} ${attachFor.patient_name}`} wide
          onClose={() => { setAttachFor(null); list.reload(); }}>
          <Attachments entry={{ id: attachFor.queue_id, patient_name: attachFor.patient_name }} />
        </Modal>
      )}
    </>
  );
}

function BillForm({ visitId }) {
  const { t } = useT();
  const toast = useToast();
  const draft = useAsync(() => api(`/bills/draft/${visitId}`), [visitId]);
  const [extra, setExtra] = useState([]);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (draft.loading && !draft.data) return <Loading />;
  if (draft.error) return <ErrorBox error={draft.error} />;
  const { visit, lines } = draft.data;

  const extraLines = extra.filter((l) => l.description.trim());
  const gross = lines.reduce((s, l) => s + Number(l.amount), 0) + extraLines.reduce((s, l) => s + Number(l.qty || 1) * Number(l.rate || 0), 0);
  const net = Math.max(0, gross - Number(discount || 0));

  async function submit() {
    setBusy(true);
    try {
      const bill = await api('/bills', {
        method: 'POST',
        body: {
          visit_id: visit.id, extra_lines: extraLines, discount: discount || 0,
          paid_amount: paid === '' ? undefined : paid, payment_mode: mode, notes,
        },
      });
      toast(t('billing.created', { no: bill.bill_no }));
      navigate(`/bills/${bill.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={visit.patient_name} subtitle={`${visit.patient_code} · ${visit.mobile}`}
        actions={<Button variant="ghost" onClick={() => navigate('/billing')}>{t('dispense.back')}</Button>} />
      <Card title={t('billing.lines')}>
        {!lines.length && !extra.length && <Empty>{t('billing.nothing')}</Empty>}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('billing.description')}</th><th className="num">{t('examine.qty')}</th><th className="num">{t('billing.rate')}</th><th className="num">{t('dispense.amount')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`l${i}`}>
                  <td data-label={t('billing.description')}>{l.line_type === 'consultation' ? t('billing.consultation') : l.description}</td>
                  <td data-label={t('examine.qty')} className="num">{l.qty}</td>
                  <td data-label={t('billing.rate')} className="num">{money(l.rate)}</td>
                  <td data-label={t('dispense.amount')} className="num">{money(l.amount)}</td>
                  <td />
                </tr>
              ))}
              {extra.map((l, i) => (
                <tr key={l.key}>
                  <td data-label={t('billing.description')}>
                    <input value={l.description} placeholder={t('billing.otherHint')} aria-label={t('billing.description')}
                      onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                  </td>
                  <td data-label={t('examine.qty')} className="num">
                    <input type="number" className="qty-input" min="1" value={l.qty} aria-label={t('examine.qty')}
                      onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
                  </td>
                  <td data-label={t('billing.rate')} className="num">
                    <input type="number" className="qty-input" min="0" step="0.01" value={l.rate} aria-label={t('billing.rate')}
                      onChange={(e) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)))} />
                  </td>
                  <td data-label={t('dispense.amount')} className="num">{money(Number(l.qty || 1) * Number(l.rate || 0))}</td>
                  <td><button className="icon-btn" aria-label={t('common.remove')} onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExtra((x) => [...x, { key: Math.random(), description: '', qty: 1, rate: '' }])}>
          <Icon name="plus" size={15} /> {t('billing.addOther')}
        </Button>
      </Card>

      <Card title={t('billing.payment')}>
        <div className="form-grid">
          <Input label={t('billing.discount')} type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          <Select label={t('billing.mode')} value={mode} onChange={(e) => setMode(e.target.value)}
            options={['cash', 'upi', 'card', 'other'].map((m) => ({ value: m, label: t(`billing.mode_${m}`) }))} />
          <Input label={t('billing.paid')} type="number" min="0" step="0.01" value={paid} placeholder={String(net.toFixed(2))}
            onChange={(e) => setPaid(e.target.value)} hint={t('billing.paidHint')} />
          <Input label={t('field.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="bill-totals">
          <div><span>{t('billing.gross')}</span><b>{money(gross)}</b></div>
          <div><span>{t('billing.discount')}</span><b>− {money(discount || 0)}</b></div>
          <div className="grand"><span>{t('billing.net')}</span><b>{money(net)}</b></div>
        </div>
        <div className="form-actions">
          <Button onClick={submit} loading={busy} disabled={!lines.length && !extraLines.length}><Icon name="receipt" size={16} /> {t('billing.generate')}</Button>
        </div>
      </Card>
    </>
  );
}

export default function PatientBill({ params }) {
  return params.visitId ? <BillForm visitId={params.visitId} /> : <Pending />;
}
