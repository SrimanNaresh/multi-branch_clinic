// Vital signs recorded after a patient is confirmed into the queue (one record per queue entry).
// Checked the same way by the UI (as you type) and the API (before saving).

// field → [min, max, decimals]
export const VITAL_LIMITS = {
  height_cm: [30, 250, 1],
  weight_kg: [0.5, 300, 1],
  bp_systolic: [50, 260, 0],
  bp_diastolic: [30, 160, 0],
  bp_r_systolic: [50, 260, 0],
  bp_r_diastolic: [30, 160, 0],
  pulse_bpm: [30, 220, 0],
  temperature_f: [86, 113, 1],
};
// Blood sugar: the test picked from the drop-down (sugar_type) and its result (sugar_value).
// type → [min, max, decimals, unit]
export const SUGAR_TYPES = {
  FBS: [20, 600, 0, 'mg/dL'],   // fasting
  PPBS: [20, 600, 0, 'mg/dL'],  // post-prandial
  RBS: [20, 600, 0, 'mg/dL'],   // random
  HbA1c: [3, 20, 1, '%'],
};
// Blood pressure per arm: L = bp_systolic / bp_diastolic (also every reading saved before), R = bp_r_*
export const BP_PAIRS = { L: ['bp_systolic', 'bp_diastolic'], R: ['bp_r_systolic', 'bp_r_diastolic'] };
export const VITAL_FIELDS = [...Object.keys(VITAL_LIMITS), 'sugar_type', 'sugar_value', 'comments'];

// English messages; the UI shows its own translation of each code (vitals.err.<code>).
export const VITAL_ERRORS = {
  number: 'must be a number',
  range: 'is outside the allowed range',
  decimals: 'has too many decimal places',
  bpBoth: 'enter both systolic and diastolic',
  bpOrder: 'diastolic must be lower than systolic',
  sugarType: 'choose FBS, PPBS, RBS or HbA1c',
  sugarEmpty: 'enter the blood sugar value',
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

  for (const [sysF, diaF] of Object.values(BP_PAIRS)) {
    const sys = data[sysF];
    const dia = data[diaF];
    if (errors[sysF] || errors[diaF]) continue;
    if ((sys == null) !== (dia == null)) errors[sys == null ? sysF : diaF] = 'bpBoth';
    else if (sys != null && dia >= sys) errors[diaF] = 'bpOrder';
  }
  const type = blank(input.sugar_type) ? null : String(input.sugar_type).trim();
  const rawSugar = input.sugar_value;
  data.sugar_type = type;
  data.sugar_value = null;
  if (type && !SUGAR_TYPES[type]) errors.sugar_type = 'sugarType';
  else if (!blank(rawSugar)) {
    const n = Number(String(rawSugar).trim());
    data.sugar_value = n;
    if (!type) errors.sugar_type = 'sugarType';
    else {
      const [min, max, decimals] = SUGAR_TYPES[type];
      if (!Number.isFinite(n)) errors.sugar_value = 'number';
      else if (n < min || n > max) errors.sugar_value = 'range';
      else if (Math.round(n * 10 ** decimals) !== n * 10 ** decimals) errors.sugar_value = 'decimals';
    }
  } else if (type) errors.sugar_value = 'sugarEmpty';

  if (Object.keys(VITAL_LIMITS).every((f) => data[f] == null) && data.sugar_value == null && !comments) errors._form = 'empty';
  return { data, errors };
}

/** Body-mass index from height (cm) and weight (kg), one decimal; null when either is missing. */
export function bmi(v) {
  if (!v?.height_cm || !v?.weight_kg) return null;
  const m = v.height_cm / 100;
  return Math.round((v.weight_kg / (m * m)) * 10) / 10;
}
