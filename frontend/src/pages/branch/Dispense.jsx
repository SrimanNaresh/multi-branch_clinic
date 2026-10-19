// Pharmacy → Dispense: issue prescribed items to the patient (reduces stock)
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../lib/i18n.jsx';
import { navigate } from '../../lib/router.jsx';
import { fmtDate, money, todayLocal } from '../../lib/format.js';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Loading, PageHeader, StatusBadge, useAsync, useToast } from '../../components/ui.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';

function PendingList() {
  const { t } = useT();
  const [date, setDate] = useState(todayLocal());
  const list = useAsync(() => api('/dispense/pending', { query: { date } }), [date]);
  const columns = [
    { key: 'token_no', label: t('queue.token'), render: (r) => <span className="token-chip">#{r.token_no ?? '—'}</span> },
    { key: 'patient_name', label: t('field.name'), render: (r) => <><b>{r.patient_name}</b><br /><span className="muted small">{r.patient_code}</span></> },
    { key: 'doctor_name', label: t('menu.doctor') },
    { key: 'visit_status', label: t('dispense.visit'), render: (r) => <StatusBadge status={r.visit_status} /> },
    { key: 'pending_lines', label: t('dispense.pending'), render: (r) => (r.pending_lines > 0 ? <Badge tone="warning">{t('dispense.linesPending', { n: r.pending_lines })}</Badge> : <Badge tone="success">{t('status.issued')}</Badge>) },
    { key: '_a', label: '', className: 'col-actions', render: (r) => <Button size="sm" variant={r.pending_lines > 0 ? 'primary' : 'ghost'} onClick={() => navigate(`/dispense/${r.visit_id}`)}>{t('common.open')}</Button> },
  ];
  return (
    <>
      <PageHeader title={t('menu.dispense')} subtitle={t('dispense.subtitle')}
        actions={<input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} aria-label={t('field.date')} />} />
      <Card>
        {list.loading && !list.data ? <Loading /> : <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && <DataTable columns={columns} rows={list.data.rows} rowKey="visit_id" empty={t('dispense.none')} onRowClick={(r) => navigate(`/dispense/${r.visit_id}`)} />}
      </Card>
    </>
  );
}

function IssueForm({ visitId }) {
  const { t } = useT();
  const toast = useToast();
  const v = useAsync(() => api(`/dispense/visit/${visitId}`), [visitId]);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!v.data) return;
    setLines(v.data.lines.map((l) => {
      const remaining = Math.max(0, Number(l.quantity) - Number(l.issued_qty));
      return {
        ...l,
        qty: l.item_id ? Math.min(remaining, Number(l.stock_qty) || 0) : 0,
        pick: !!l.item_id && remaining > 0 && Number(l.stock_qty) > 0,
      };
    }));
  }, [v.data]);

  if (v.loading && !v.data) return <Loading />;
  if (v.error) return <ErrorBox error={v.error} />;
  const visit = v.data;
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const chosen = lines.filter((l) => l.pick && l.item_id && Number(l.qty) > 0);
  const total = chosen.reduce((s, l) => s + Number(l.qty) * Number(l.price || 0), 0);

  async function issue() {
    setBusy(true);
    try {
      await api(`/dispense/visit/${visitId}`, {
        method: 'POST',
        body: { lines: chosen.map((l) => ({ prescription_id: l.prescription_id, item_id: l.item_id, qty: Number(l.qty) })) },
      });
      toast(t('dispense.issued'));
      v.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={visit.patient_name}
        subtitle={`${visit.patient_code} · ${t('queue.token')} #${visit.token_no ?? '—'} · ${fmtDate(visit.visit_date, true)}`}
        actions={<Button variant="ghost" onClick={() => navigate('/dispense')}>{t('dispense.back')}</Button>}
      />
      <Card title={t('examine.prescription')}>
        {!lines.length && <Empty>{t('dispense.noRx')}</Empty>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>{t('examine.medicine')}</th><th>{t('dispense.stockItem')}</th><th>{t('examine.dosage')}</th>
                <th className="num">{t('dispense.prescribed')}</th><th className="num">{t('dispense.alreadyIssued')}</th>
                <th className="num">{t('items.stock')}</th><th className="num">{t('dispense.issueQty')}</th><th className="num">{t('dispense.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const remaining = Math.max(0, Number(l.quantity) - Number(l.issued_qty));
                const over = Number(l.qty) > Number(l.stock_qty || 0);
                return (
                  <tr key={l.prescription_id} className={remaining === 0 ? 'row-done' : ''}>
                    <td data-label="">
                      <input type="checkbox" aria-label={t('dispense.select')} checked={l.pick} disabled={!l.item_id}
                        onChange={(e) => setLine(i, { pick: e.target.checked })} />
                    </td>
                    <td data-label={t('examine.medicine')}><b>{l.medicine_name}{l.potency ? ` ${l.potency}` : ''}</b><br /><span className="muted small">{[l.dosage, l.frequency, l.duration].filter(Boolean).join(' · ')}</span></td>
                    <td data-label={t('dispense.stockItem')}>
                      {l.item_id ? l.item_name : (
                        <ItemPicker placeholder={t('dispense.linkItem')} ariaLabel={t('dispense.linkItem')}
                          onPick={(p) => p.item && setLine(i, { item_id: p.item.id, item_name: p.item.name, price: p.item.price, stock_qty: p.item.stock_qty, unit: p.item.unit, qty: Math.min(remaining, Number(p.item.stock_qty)), pick: true })} />
                      )}
                    </td>
                    <td data-label={t('examine.dosage')}>{l.dosage || '—'}</td>
                    <td data-label={t('dispense.prescribed')} className="num">{l.quantity}</td>
                    <td data-label={t('dispense.alreadyIssued')} className="num">{l.issued_qty}</td>
                    <td data-label={t('items.stock')} className="num">{l.item_id ? `${l.stock_qty} ${l.unit || ''}` : '—'}</td>
                    <td data-label={t('dispense.issueQty')} className="num">
                      <input type="number" className={`qty-input ${over ? 'invalid' : ''}`} min="0" step="0.5" value={l.qty} disabled={!l.pick}
                        onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={t('dispense.issueQty')} />
                    </td>
                    <td data-label={t('dispense.amount')} className="num">{l.pick ? money(Number(l.qty) * Number(l.price || 0)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="total-row">
          <span>{t('dispense.total')}</span>
          <strong>{money(total)}</strong>
        </div>
        <div className="form-actions">
          <Button onClick={issue} loading={busy} disabled={!chosen.length}>{t('dispense.issueBtn', { n: chosen.length })}</Button>
        </div>
      </Card>

      {visit.issues.length > 0 && (
        <Card title={t('dispense.history')}>
          <DataTable rows={visit.issues} columns={[
            { key: 'issued_at', label: t('queue.time'), render: (r) => fmtDate(r.issued_at, true) },
            { key: 'issued_by_name', label: t('dispense.by') },
            { key: 'items_total', label: t('dispense.amount'), render: (r) => money(r.items_total), className: 'num' },
            { key: 'status', label: t('field.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}
    </>
  );
}

export default function Dispense({ params }) {
  return params.visitId ? <IssueForm visitId={params.visitId} /> : <PendingList />;
}
