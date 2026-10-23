// Prescription lists (Examine → Prescription → Potency / Dosage / Repetition), one list per clinic and kind.
// Every clinic starts with the defaults below (Order 1, 2, 3 …); all rows can be renamed and reordered,
// and new ones added with "+ New".
export const RX_LIST_DEFAULTS = {
  potency: ['6C', '30C', '200C', '1M', '10M', 'Q'],
  dosage: ['1 Tablet', '2 Tablet', '4 Tablet'],
  repetition: ['TDS', 'QDS', 'OD', 'HS'],          // saved in prescriptions.frequency
  dosdont: ['Smoking', 'Alcohol'],                 // Examine → Advice → Do's and Don'ts (saved in visits.dos_donts)
  pasthistory: ['ENT', 'Ortho', 'Dental'],         // Examine → Complaints & diagnosis → Examination History (visits.past_history)
  medhistory: ['Smoking', 'Alcohol', 'Tobacco'],   // Examine → Complaints & diagnosis → Medical History (visits.medical_history)
};
export const RX_LIST_KINDS = Object.keys(RX_LIST_DEFAULTS);
export const DOSAGE_MASTER = RX_LIST_DEFAULTS.dosage;
export const POTENCY_MASTER = RX_LIST_DEFAULTS.potency;
export const MAX_ORDER = 999;

/** The default rows a clinic starts with for one list. */
export const defaultsFor = (kind) => RX_LIST_DEFAULTS[kind].map((value, i) => ({ value, sort_order: i + 1 }));
export const defaultDosages = () => defaultsFor('dosage');

/** A dosage as typed: trimmed, single spaces, at most 100 characters; '' when empty. */
export const cleanDosage = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);

/** Order as entered → whole number 0–999, or null when it isn't one. */
export function cleanOrder(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_ORDER ? n : null;
}

/**
 * The list shown in the dropdown, by Order (lower first; equal Order → alphabetical).
 * rows: [{ value, sort_order }]. Repeats (any case) appear once, the lowest Order wins.
 */
export function dosageOptions(rows = []) {
  const list = rows.filter(Boolean)
    .map((r) => ({ value: cleanDosage(r.value), order: r.sort_order ?? MAX_ORDER }))
    .filter((r) => r.value)
    .sort((a, b) => a.order - b.order || a.value.localeCompare(b.value));
  const seen = new Set();
  return list.filter((r) => !seen.has(r.value.toLowerCase()) && seen.add(r.value.toLowerCase())).map((r) => r.value);
}

/** Order for a new dosage: after everything already in the list. */
export function nextOrder(rows = []) {
  return Math.min(MAX_ORDER, Math.max(0, ...rows.map((r) => r.sort_order ?? 0)) + 1);
}
