// Printable bill. "Print / PDF" uses the browser print dialog (choose "Save as PDF").
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { ageLabel, fmtDate, genderLabel, money } from '../../lib/format.js';
import { Button, ErrorBox, Loading, StatusBadge, useAsync, useToast } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';

export default function BillView({ params }) {
  const { t } = useT();
  const auth = useAuth();
  const toast = useToast();
  const { data: b, error, loading, reload } = useAsync(() => api(`/bills/${params.id}`), [params.id]);
  const [busy, setBusy] = useState(false);

  async function cancelBill() {
    const reason = window.prompt(t('billing.cancelReason'));
    if (reason === null) return;
    setBusy(true);
    try {
      await api(`/bills/${b.id}/cancel`, { method: 'POST', body: { reason } });
      toast(t('billing.cancelled'));
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="no-print page-header">
        <Button variant="ghost" onClick={() => navigate(auth.can('bill.view') ? '/bills' : '/billing')}>‹ {t('dispense.back')}</Button>
        <div className="page-actions">
          {auth.can('bill.cancel') && b.status !== 'cancelled' && <Button variant="danger" onClick={cancelBill} loading={busy}>{t('billing.cancelBill')}</Button>}
          <Button onClick={() => window.print()}><Icon name="print" size={16} /> {t('billing.print')}</Button>
        </div>
      </div>

      <article className="invoice">
        <header className="inv-head">
          <div>
            <h1>{b.clinic_name}</h1>
            <p>{[b.clinic_address, b.clinic_city].filter(Boolean).join(', ')}</p>
            {b.clinic_phone && <p>{t('field.phone')}: {b.clinic_phone}</p>}
          </div>
          <div className="inv-brand">Ayush Pro</div>
        </header>
        <div className="inv-meta">
          <div>
            <span className="muted">{t('billing.billTo')}</span>
            <strong>{b.patient_name}</strong>
            <span>{b.patient_code} · {genderLabel(b.gender, t)} / {ageLabel(b)}</span>
            <span>{b.mobile}</span>
          </div>
          <div className="right">
            <span className="muted">{t('billing.billNo')}</span>
            <strong>{b.bill_no}</strong>
            <span>{fmtDate(b.bill_date, true)}</span>
            {b.doctor_name && <span>{t('menu.doctor')}: {b.doctor_name}</span>}
            <span className="no-print"><StatusBadge status={b.status} /></span>
          </div>
        </div>
        {b.status === 'cancelled' && <div className="inv-cancelled">{t('status.cancelled')}</div>}
        <table className="inv-table">
          <thead>
            <tr><th>#</th><th>{t('billing.description')}</th><th className="num">{t('examine.qty')}</th><th className="num">{t('billing.rate')}</th><th className="num">{t('dispense.amount')}</th></tr>
          </thead>
          <tbody>
            {b.items.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{it.line_type === 'consultation' ? t('billing.consultation') : it.description}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{money(it.rate)}</td>
                <td className="num">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inv-totals">
          {b.consultation_fee > 0 && <div><span>{t('billing.consultation')}</span><span>{money(b.consultation_fee)}</span></div>}
          {b.items_total > 0 && <div><span>{t('billing.medicines')}</span><span>{money(b.items_total)}</span></div>}
          {b.other_total > 0 && <div><span>{t('billing.others')}</span><span>{money(b.other_total)}</span></div>}
          {b.discount > 0 && <div><span>{t('billing.discount')}</span><span>− {money(b.discount)}</span></div>}
          <div className="grand"><span>{t('billing.net')}</span><span>{money(b.net_amount)}</span></div>
          <div><span>{t('billing.paid')} ({t(`billing.mode_${b.payment_mode}`)})</span><span>{money(b.paid_amount)}</span></div>
          {b.net_amount - b.paid_amount > 0 && <div><span>{t('billing.balance')}</span><span>{money(b.net_amount - b.paid_amount)}</span></div>}
        </div>
        {b.notes && <p className="inv-notes">{b.notes}</p>}
        <footer className="inv-foot">
          <span>{t('billing.inclusive')}</span>
          <span>{t('billing.preparedBy')}: {b.created_by_name}</span>
        </footer>
      </article>
    </>
  );
}
