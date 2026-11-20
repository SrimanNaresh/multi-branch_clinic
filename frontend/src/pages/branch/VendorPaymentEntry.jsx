// Pharmacy → Vendor → Payments: pay a vendor against one of its Stock Ins (bills), and the list of payments.
// Picking a vendor lists its bills with Bill − Returned − Paid = Balance; the amount starts at the balance and
// cannot be more. Cheque / NEFT / UPI need a reference no. Only an Admin may delete a payment.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import {
  Button, Card, DataTable, ErrorBox, Input, Loading, Pagination, SearchBox, Select, TextArea, useAsync, useDebounced, useToast,
} from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import VendorPicker from '../../components/VendorPicker.jsx';

const MODES = ['cash', 'upi', 'card', 'cheque', 'neft', 'other'];
const NEEDS_REF = ['cheque', 'neft', 'upi'];
const EMPTY = () => ({ supplier_id: '', stock_in_id: '', pay_date: todayLocal(), amount: '', pay_mode: 'cash', reference_no: '', notes: '' });

export default function VendorPaymentEntry() {
  const { t } = useT();
  const toast = useToast();
  const { isGlobal: isAdmin } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const vendors = useAsync(() => api('/suppliers', { query: { status: 'active' } }), []);
  const bills = useAsync(
    () => (form.supplier_id ? api('/vendor-payments/invoices', { query: { supplier_id: form.supplier_id } }) : Promise.resolve({ rows: [] })),
    [form.supplier_id],
  );
  const list = useAsync(() => api('/vendor-payments', { query: { q: dq, page, limit: 50 } }), [dq, page]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const bill = (bills.data?.rows || []).find((b) => String(b.stock_in_id) === form.stock_in_id);
  const openBills = (bills.data?.rows || []).filter((b) => b.balance > 0 || String(b.stock_in_id) === form.stock_in_id);
  const over = bill && Number(form.amount) > bill.balance;

  async function submit(e) {
    e.preventDefault();
    if (!form.supplier_id) { setError(t('purchase.chooseVendor')); return; }
    if (!form.stock_in_id) { setError(t('vpay.chooseBill')); return; }
    if (!(Number(form.amount) > 0)) { setError(t('vpay.enterAmount')); return; }
    if (over) { setError(t('vpay.overBalance', { n: money(bill.balance) })); return; }
    if (NEEDS_REF.includes(form.pay_mode) && !form.reference_no.trim()) { setError(t('vpay.needRef')); return; }
    setSaving(true);
    setError('');
    try {
      const p = await api('/vendor-payments', { method: 'POST', body: form });
      toast(t('vpay.saved', { no: p.payment_no, amount: money(p.amount) }));
      setForm((f) => ({ ...EMPTY(), supplier_id: f.supplier_id }));
      bills.reload();
      list.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(r) {
    if (!window.confirm(t('vpay.deleteConfirm', { no: r.payment_no }))) return;
    try {
      await api(`/vendor-payments/${r.id}`, { method: 'DELETE' });
      toast(t('pharma.deleted', { no: r.payment_no }));
      list.reload();
      bills.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const billOptions = openBills.map((b) => ({
    value: String(b.stock_in_id),
    label: `${b.si_no}${b.bill_no ? ` (${b.bill_no})` : ''} · ${fmtDate(b.si_date)} · ${t('vpay.balance')} ${money(b.balance)}`,
  }));
  const columns = [
    { key: 'payment_no', label: t('vpay.no'), render: (r) => <b>{r.payment_no}</b> },
    { key: 'pay_date', label: t('purchase.date'), render: (r) => fmtDate(r.pay_date) },
    { key: 'supplier_name', label: t('purchase.vendor') },
    { key: 'si_no', label: t('stockin.no'), render: (r) => <>{r.si_no}{r.bill_no && <small className="muted si-vendor">{t('pharma.billNo')} {r.bill_no}</small>}</> },
    { key: 'pay_mode', label: t('vpay.mode'), render: (r) => t(`vpay.mode.${r.pay_mode}`) },
    { key: 'reference_no', label: t('vpay.refNo'), render: (r) => r.reference_no || '—' },
    { key: 'amount', label: t('purchase.amount'), className: 'num', render: (r) => <b>{money(r.amount)}</b> },
    {
      key: '_a', label: '', className: 'col-actions',
      render: (r) => isAdmin && (
        <Button size="sm" variant="ghost" className="btn-danger-ghost" onClick={() => remove(r)}><Icon name="trash" size={15} /> {t('common.delete')}</Button>
      ),
    },
  ];

  return (
    <>
      <form onSubmit={submit}>
        <Card className="item-card">
          <div className="compact-head">
            <span className="compact-head-icon"><Icon name="receipt" size={16} /></span>
            <div>
              <h1>{t('vpay.new')}</h1>
              <p className="muted">{t('vpay.hint')}</p>
            </div>
          </div>
          <div className="form-grid">
            <VendorPicker label={t('purchase.vendor')} required vendors={vendors.data?.rows || []} value={form.supplier_id}
              onPick={(v) => set({ supplier_id: String(v.id), stock_in_id: '', amount: '' })} />
            <Select label={t('vpay.bill')} required placeholder={form.supplier_id ? '—' : t('stockin.vendorFirst')}
              disabled={!form.supplier_id} value={form.stock_in_id} options={billOptions}
              onChange={(e) => {
                const b = openBills.find((x) => String(x.stock_in_id) === e.target.value);
                set({ stock_in_id: e.target.value, amount: b ? String(b.balance) : '' });
              }} />
            <Input label={t('purchase.date')} type="date" required max={todayLocal()} value={form.pay_date}
              onChange={(e) => set({ pay_date: e.target.value })} />
            <Input label={t('purchase.amount')} type="number" min="0" step="0.01" inputMode="decimal" required
              className={over ? 'cell-bad' : undefined} value={form.amount} onChange={(e) => set({ amount: e.target.value })}
              hint={bill ? t('vpay.billHint', { bill: money(bill.bill_amount), ret: money(bill.returned_amount), paid: money(bill.paid_amount), bal: money(bill.balance) }) : undefined} />
            <Select label={t('vpay.mode')} required value={form.pay_mode}
              options={MODES.map((m) => ({ value: m, label: t(`vpay.mode.${m}`) }))} onChange={(e) => set({ pay_mode: e.target.value })} />
            <Input label={t('vpay.refNo')} required={NEEDS_REF.includes(form.pay_mode)} maxLength={50} value={form.reference_no}
              onChange={(e) => set({ reference_no: e.target.value })} />
            <TextArea label={t('vpay.notes')} rows={1} maxLength={300} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          {form.supplier_id && !bills.loading && !billOptions.length && <p className="muted">{t('vpay.nothingDue')}</p>}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions item-actions">
            <Button type="submit" loading={saving}><Icon name="receipt" size={16} /> {t('vpay.save')}</Button>
          </div>
        </Card>
      </form>

      <Card className="crud-compact" title={list.data ? t('vpay.count', { n: list.data.total, amount: money(list.data.amount) }) : t('vpay.list')}>
        <div className="toolbar">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('vpay.searchHint')} />
        </div>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (
          <>
            <DataTable columns={columns} rows={list.data.rows} empty={t('vpay.none')} />
            <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
