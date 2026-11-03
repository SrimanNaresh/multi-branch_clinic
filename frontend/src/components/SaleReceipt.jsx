// Pharmacy → Sales: the printed receipt. useReceiptPrinter() gives print(sale, after) and the node to render;
// print() shows the receipt, opens the print dialog and calls `after` once printing is done.
// Only the receipt is printed (see .receipt-print in styles.css).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n.jsx';
import { fmtDate, money } from '../lib/format.js';

const qtyText = (n) => String(Number(n || 0));

export function SaleReceipt({ sale }) {
  const { t } = useT();
  const c = sale.clinic || {};
  const anyDisc = sale.lines.some((l) => Number(l.disc_percent) > 0);
  const billDisc = Number(sale.discount_amount) > 0;
  return (
    <div className="receipt-print">
      <div className="receipt-head">
        <b className="receipt-clinic">{c.name}</b>
        {[c.address, c.city].filter(Boolean).length > 0 && <div>{[c.address, c.city].filter(Boolean).join(', ')}</div>}
        {(c.phone || c.email) && <div>{[c.phone, c.email].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="receipt-meta">
        <span>{t('sale.billNo')}: <b>{sale.sale_no}</b></span>
        <span>{t('purchase.date')}: {fmtDate(sale.sale_date)}</span>
        <span>{t('sale.customer')}: {sale.customer_name}{sale.mobile ? ` · ${sale.mobile}` : ''}</span>
      </div>
      <table className="receipt-lines">
        <thead>
          <tr>
            <th>{t('sale.item')}</th>
            <th>{t('sale.batch')}</th>
            <th className="num">{t('sale.qty')}</th>
            <th className="num">{t('sale.rate')}</th>
            {anyDisc && <th className="num">{t('purchase.disc')}</th>}
            <th className="num">{t('purchase.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.item_name}{l.sale_unit === 'unit' ? ` (${t('sale.unitWord')})` : ''}</td>
              <td>{l.batch_no || '—'}</td>
              <td className="num">{qtyText(l.unit_qty ?? l.qty)}</td>
              <td className="num">{Number(l.price).toFixed(2)}</td>
              {anyDisc && <td className="num">{Number(l.disc_percent) > 0 ? qtyText(l.disc_percent) : ''}</td>}
              <td className="num">{Number(l.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {billDisc && (
            <>
              <tr><td colSpan={anyDisc ? 5 : 4}>{t('sale.subTotal')}</td><td className="num">{money(sale.sub_total)}</td></tr>
              <tr><td colSpan={anyDisc ? 5 : 4}>{t('sale.discountN', { n: qtyText(sale.disc_percent) })}</td><td className="num">− {money(sale.discount_amount)}</td></tr>
            </>
          )}
          <tr className="receipt-total"><td colSpan={anyDisc ? 5 : 4}>{t('sale.total')}</td><td className="num">{money(sale.total_amount)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

export function useReceiptPrinter() {
  const [job, setJob] = useState(null);   // { sale, after }
  useEffect(() => {
    if (!job) return undefined;
    const done = () => { setJob(null); job.after?.(); };
    window.addEventListener('afterprint', done, { once: true });
    const timer = setTimeout(() => window.print(), 50);   // after the receipt is on the page
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [job]);
  return {
    print: (sale, after) => setJob({ sale, after }),
    node: job ? createPortal(<SaleReceipt sale={job.sale} />, document.body) : null,   // straight under <body>, for printing
  };
}
