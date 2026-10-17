// Vital signs recorded after a patient is confirmed into the queue (one record per queue entry).
// Checked the same way by the UI (as you type) and the API (before saving).

// field → [min, max, decimals]
export const VITAL_LIMITS = {
  height_cm: [30, 250, 1],
  weight_kg: [0.5, 300, 1],
  bp_systolic: [50, 260, 0],
  bp_diastolic: [30, 160, 0],
  pulse_bpm: [30, 220, 0],
  temperature_c: [30, 45, 1],
};
export const VITAL_FIELDS = [...Object.keys(VITAL_LIMITS), 'comments'];

// English messages; the UI shows its own translation of each code (vitals.err.<code>).
export const VITAL_ERRORS = {
  number: 'must be a number',
  range: 'is outside the allowed range',
  decimals: 'has too many decimal places',
  bpBoth: 'enter both systolic and diastolic',
  bpOrder: 'diastolic must be lower than systolic',
  empty: 'enter at least one vital sign',
  comments: 'comments are too long (500 characters max)',
};

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * @returns {{ data: object, errors: { [field]: code } }}
 * data has every field (numbers, or null when left empty; comments trimmed or null).
 */
export function checkVitals(input = {}) {
  const data = {};
  const errors = {};
  for (const [field, [min, max, decimals]] of Object.entries(VITAL_LIMITS)) {
    const raw = input[field];
    if (blank(raw)) { data[field] = null; continue; }
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) errors[field] = 'number';
    else if (n < min || n > max) errors[field] = 'range';
    else if (Math.round(n * 10 ** decimals) !== n * 10 ** decimals) errors[field] = 'decimals';
    data[field] = n;
  }
  const comments = blank(input.comments) ? null : String(input.comments).trim();
  if (comments && comments.length > 500) errors.comments = 'comments';
  data.comments = comments;

  const sys = data.bp_systolic;
  const dia = data.bp_diastolic;
  if (!errors.bp_systolic && !errors.bp_diastolic) {
    if ((sys == null) !== (dia == null)) errors[sys == null ? 'bp_systolic' : 'bp_diastolic'] = 'bpBoth';
    else if (sys != null && dia >= sys) errors.bp_diastolic = 'bpOrder';
  }
  if (Object.keys(VITAL_LIMITS).every((f) => data[f] == null) && !comments) errors._form = 'empty';
  return { data, errors };
}

/** Body-mass index from height (cm) and weight (kg), one decimal; null when either is missing. */
export function bmi(v) {
  if (!v?.height_cm || !v?.weight_kg) return null;
  const m = v.height_cm / 100;
  return Math.round((v.weight_kg / (m * m)) * 10) / 10;
}
