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

/** "16:20" → "04:20 pm" (12-hour clock, same style as the times from fmtDate) */
export function fmtTime12(hhmm) {
  if (!hhmm) return '—';
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "16:00", "16:20" → "04:00 pm – 04:20 pm" */
export const fmtTimeRange12 = (from, to) => `${fmtTime12(from)} – ${fmtTime12(to)}`;

/**
 * Status shown for a queue entry (the stored status is 'waiting' for the first three):
 * a patient booked from Tokens is "Token booked" until the Confirm button is clicked, then "Token confirmed";
 * a walk-in is Pre-Examine until their vital signs are saved, then "Token confirmed".
 * Saving vital signs never changes the stored status; only Send to doctor moves a patient to Examine.
 */
export function queueStatus(r) {
  if (r.status !== 'waiting') return r.status;
  if (r.slot_time) return r.arrived_at ? 'confirmed' : 'booked';
  return r.vitals_id ? 'confirmed' : 'waiting';
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
