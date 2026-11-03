// Mf.Date / Exp.Date typed as MM/YY (digits only: '0228' → '02/28'); the server takes 'YYYY-MM'.

/** What is typed, as MM/YY: digits only, at most 4, '/' after the month */
export function typeMMYY(raw) {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** 'MM/YY' → 'YYYY-MM'; '' when empty, null when not a whole, valid month */
export function mmyyToMonth(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(s);
  return m ? `20${m[2]}-${m[1]}` : null;
}

/** 'YYYY-MM' (or a date) → 'MM/YY' */
export function monthToMMYY(v) {
  const s = String(v ?? '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? `${s.slice(5, 7)}/${s.slice(2, 4)}` : '';
}
