export const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const num = (n) => Number(n || 0).toLocaleString('en-IN');

/** "2026-10-16 18:52:10" → "16 Oct 2026" (+ time) */
export function fmtDate(s, withTime = false) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return withTime ? `${date}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : date;
}

export function todayLocal() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function ageLabel(p) {
  if (p.age_years != null) return `${p.age_years}`;
  if (p.dob) {
    const b = new Date(p.dob);
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a -= 1;
    return String(a);
  }
  return '—';
}

export const genderLabel = (g, t) => (g ? t(`gender.${g}`) : '—');
