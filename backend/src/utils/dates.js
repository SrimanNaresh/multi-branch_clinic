import { env } from '../config/env.js';

/** YYYY-MM-DD in the clinic time zone (default Asia/Kolkata). */
export function todayISO(date = new Date(), tz = env.tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Minutes since midnight right now in the clinic time zone (e.g. 09:30 → 570). */
export function nowMinutes(date = new Date(), tz = env.tz) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(date).split(':').map(Number);
  return h * 60 + m;
}

/** Next calendar day of a YYYY-MM-DD string. */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthStartISO(iso) {
  return `${iso.slice(0, 7)}-01`;
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
