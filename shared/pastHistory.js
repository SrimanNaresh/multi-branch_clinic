// Examine → Complaints & diagnosis → Past History: what applies to the patient, with a short note each.
// Saved with each visit (visits.past_history) as JSON; a visit never saved starts from the patient's
// previous visit, so the doctor does not type it again:
// [{ item: 'ENT', note: 'Tonsillectomy 2019', answers: [{ q: 'Duration', a: '2 years' }] }, …]
// Ticking an item shows its questions (editable per item); each answer is a short text.
import { cleanDosage } from './dosage.js';

export const MAX_PAST_HISTORY = 50;
export const MAX_PAST_NOTE = 200;
export const MAX_PAST_ANSWER = 200;
export const MAX_PAST_ANSWERS = 30;

/** Questions an item starts with (matched by item name, any case); other items start with none. */
export const PAST_QUESTION_DEFAULTS = {
  ent: ['Symptom Character', 'Triggers', 'Duration', 'Tinnitus', 'Hearing Changes', 'Infections', 'Barotrauma'],
};
export const pastQuestionDefaults = (item) =>
  (PAST_QUESTION_DEFAULTS[String(item ?? '').trim().toLowerCase()] || []).map((value, i) => ({ value, sort_order: i + 1 }));

const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Answers as sent / stored → [{ q, a }]: both tidied, empty answers dropped, each question once (last wins). */
export function cleanAnswers(list) {
  if (!Array.isArray(list)) return [];
  const byQ = new Map();
  for (const x of list) {
    const q = cleanDosage(x?.q);
    const a = tidy(x?.a, MAX_PAST_ANSWER);
    if (!q) continue;
    byQ.delete(q.toLowerCase());
    if (a) byQ.set(q.toLowerCase(), { q, a });
  }
  return [...byQ.values()].slice(0, MAX_PAST_ANSWERS);
}

/** Ticked items as sent / stored → clean list: item tidied, note trimmed (≤ 200), each item once (last wins). */
export function cleanPastHistory(list) {
  if (!Array.isArray(list)) return [];
  const byItem = new Map();
  for (const h of list) {
    const item = cleanDosage(h?.item);
    if (!item) continue;
    const note = tidy(h?.note, MAX_PAST_NOTE);
    const answers = cleanAnswers(h?.answers);
    byItem.delete(item.toLowerCase());
    byItem.set(item.toLowerCase(), answers.length ? { item, note, answers } : { item, note });
  }
  return [...byItem.values()].slice(0, MAX_PAST_HISTORY);
}

/** visits.past_history column → list ([] when empty or unreadable). */
export function parsePastHistory(text) {
  if (!text) return [];
  try { return cleanPastHistory(JSON.parse(text)); } catch { return []; }
}
