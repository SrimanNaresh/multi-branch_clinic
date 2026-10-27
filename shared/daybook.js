// Examine → Prescription → Day Book → day-wise chart: one row per day from the Day Book date, one tick box
// per routine and time of day, for the patient to fill in at home. Same rules on the screen and the printout.

export const DEFAULT_CHART_DAYS = 7;
export const MAX_CHART_DAYS = 90;

/**
 * Day Book text (Duration and Frequency together, e.g. "Every Day", "Twice a day") → which times of day
 * get a box and how often a day is due.
 *   "Twice a day" / BD → morning + evening;  "Thrice" / TDS → morning + afternoon + evening
 *   "Alternate days" → every 2nd day;  "Weekly" → every 7th day;  anything else (Daily, empty) → once a day
 */
export function frequencyPlan(frequency) {
  const f = String(frequency || '').toLowerCase();
  let slots = ['once'];
  if (/thrice|three|3 times|\btds\b|\btid\b/.test(f)) slots = ['morning', 'afternoon', 'evening'];
  else if (/twice|two times|2 times|\bbd\b|\bbid\b/.test(f)) slots = ['morning', 'evening'];
  let every = 1;
  if (/week/.test(f)) every = 7;
  else if (/alternate|every other/.test(f)) every = 2;
  return { slots, every };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (iso) => new Date(`${iso}T00:00:00Z`);

/** A Frequency that is just a number of days ("5", "5 days") → that number (1–90); otherwise null. */
export function daysFromFrequency(frequency) {
  const m = /^\s*(\d{1,3})\s*(days?)?\s*$/i.exec(String(frequency || ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= MAX_CHART_DAYS ? n : null;
}

/** Days to show: the Frequency's number of days; else up to the follow-up date (at most 90); else 7. */
export function defaultChartDays(startIso, followUpIso, frequency) {
  const fromFrequency = daysFromFrequency(frequency);
  if (fromFrequency) return fromFrequency;
  if (ISO.test(startIso || '') && ISO.test(followUpIso || '')) {
    const diff = Math.round((utc(followUpIso) - utc(startIso)) / 86400000);
    if (diff >= 1) return Math.min(diff, MAX_CHART_DAYS);
  }
  return DEFAULT_CHART_DAYS;
}

/** Days as typed → whole number 1–90 (fallback when it isn't one). */
export function cleanChartDays(v, fallback = DEFAULT_CHART_DAYS) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_CHART_DAYS ? n : fallback;
}

/** [{ date: 'YYYY-MM-DD', weekday: 0–6, due }] for `days` days from startIso; due = a routine day under `every`. */
export function chartDays(startIso, days, every = 1) {
  if (!ISO.test(startIso || '')) return [];
  const start = utc(startIso);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), due: i % every === 0 };
  });
}

/* ---------- what is typed in the chart: saved with the visit (visits.daybook_chart, JSON) ---------- */

export const MAX_CHART_TEXT = 50;
const MAX_CHART_CELLS = 2000;

/** Key of one chart box: "date|routine|slot" (or "date|remarks"). */
export const chartCellKey = (date, routine, slot) => [date, routine, slot].filter(Boolean).join('|');

/** Typed boxes as sent → { key: text } with only filled boxes (trimmed, at most 50 characters each). */
export function cleanChartValues(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input).slice(0, MAX_CHART_CELLS)) {
    const key = String(k).slice(0, 300);
    const text = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHART_TEXT);
    if (/^\d{4}-\d{2}-\d{2}\|/.test(key) && text) out[key] = text;
  }
  return out;
}
