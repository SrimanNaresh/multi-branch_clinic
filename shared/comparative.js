// Examine → Complaints & diagnosis → Comparative Study: one row = Date, Tine, Rt.H, Lt.H.
// The same checks run on the screen (before saving) and in the API.

export const MAX_READING = 100;
export const MAX_TIME = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const tidy = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Row as entered → { row } or { error }:
 *   error 'date'    – Date missing / not a real date
 *   error 'reading' – neither Rt.H nor Lt.H filled
 * Tine (study_time) is short text as typed, up to 20 characters; Rt.H / Lt.H up to 100; empty → null.
 */
export function checkComparative(input = {}) {
  const study_date = tidy(input.study_date);
  if (!ISO_DATE.test(study_date) || Number.isNaN(new Date(`${study_date}T00:00:00Z`).getTime())
    || new Date(`${study_date}T00:00:00Z`).toISOString().slice(0, 10) !== study_date) return { error: 'date' };
  const study_time = tidy(input.study_time).slice(0, MAX_TIME);
  const rt_h = tidy(input.rt_h).slice(0, MAX_READING) || null;
  const lt_h = tidy(input.lt_h).slice(0, MAX_READING) || null;
  if (!rt_h && !lt_h) return { error: 'reading' };
  return { row: { study_date, study_time: study_time || null, rt_h, lt_h } };
}

/** Rows oldest first: by date, then time (no time first), then id. */
export function sortComparative(rows = []) {
  return [...rows].sort((a, b) => String(a.study_date).localeCompare(String(b.study_date))
    || String(a.study_time || '').localeCompare(String(b.study_time || '')) || (a.id ?? 0) - (b.id ?? 0));
}
