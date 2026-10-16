import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.jsx';

/* ---------------- data hooks ---------------- */

/** Runs `fn` on mount and whenever deps change. Returns { data, error, loading, reload }. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

/** Simple form state: const f = useForm(initial); f.bind('name') → props for an input */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));
  const bind = (name) => ({
    name,
    value: values[name] ?? '',
    onChange: (e) => set(name, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
  });
  return { values, setValues, set, bind };
}

/* ---------------- toast ---------------- */

const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, message, type }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((x) => <div key={x.id} className={`toast toast-${x.type}`}>{x.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ---------------- layout pieces ---------------- */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', size, loading, children, className = '', ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const STATUS_TONE = {
  active: 'success', inactive: 'neutral',
  waiting: 'warning', with_doctor: 'info', done: 'success', cancelled: 'neutral',
  paid: 'success', partial: 'warning', unpaid: 'danger',
  open: 'info', completed: 'success', issued: 'info', billed: 'success',
};
export function StatusBadge({ status }) {
  const { t } = useT();
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{t(`status.${status}`)}</Badge>;
}

export function Loading() {
  const { t } = useT();
  return <div className="loading"><span className="spinner" /> {t('common.loading')}</div>;
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <span>{error.message}</span>
      {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/* ---------------- form fields ---------------- */

export function Field({ label, required, hint, error, children, full }) {
  return (
    <label className={`field ${full ? 'field-full' : ''}`}>
      <span className="field-label">{label}{required && <b className="req"> *</b>}</span>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function Input({ label, required, hint, full, ...props }) {
  return <Field label={label} required={required} hint={hint} full={full}><input required={required} {...props} /></Field>;
}

export function Select({ label, required, hint, full, options, placeholder, ...props }) {
  return (
    <Field label={label} required={required} hint={hint} full={full}>
      <select required={required} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function TextArea({ label, required, full = true, rows = 3, ...props }) {
  return <Field label={label} required={required} full={full}><textarea rows={rows} required={required} {...props} /></Field>;
}

export function SearchBox({ value, onChange, placeholder, autoFocus }) {
  return (
    <div className="search-box">
      <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  );
}

/* ---------------- table + paging ---------------- */

/**
 * columns: [{ key, label, render?(row), className? }]
 * On phones each row becomes a card (labels come from data-label).
 */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick, empty }) {
  const { t } = useT();
  if (!rows?.length) return <Empty>{empty || t('common.noRecords')}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.className}><div className="cell">{c.render ? c.render(r) : r[c.key] ?? '—'}</div></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const { t } = useT();
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ {t('common.prev')}</Button>
      <span className="muted">{t('common.pageOf', { page, pages })}</span>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')} ›</Button>
    </div>
  );
}

/* ---------------- modal ---------------- */

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
