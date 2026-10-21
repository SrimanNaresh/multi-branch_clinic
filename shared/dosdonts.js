// Examine → Advice → Do's and Don'ts: what the doctor marks for a visit.
// Saved in visits.dos_donts as JSON: [{ item: 'Smoking', rule: 'dont' }, …]; unmarked items are not saved.
import { cleanDosage } from './dosage.js';

export const DOSDONT_RULES = ['do', 'dont'];
export const MAX_DOSDONTS = 50;

/** Marks as sent / stored → clean list: item text tidied, rule 'do' | 'dont', each item once (last wins). */
export function cleanDosDonts(list) {
  if (!Array.isArray(list)) return [];
  const byItem = new Map();
  for (const m of list) {
    const item = cleanDosage(m?.item);
    if (!item || !DOSDONT_RULES.includes(m?.rule)) continue;
    byItem.delete(item.toLowerCase());
    byItem.set(item.toLowerCase(), { item, rule: m.rule });
  }
  return [...byItem.values()].slice(0, MAX_DOSDONTS);
}

/** visits.dos_donts column → list ([] when empty or unreadable). */
export function parseDosDonts(text) {
  if (!text) return [];
  try { return cleanDosDonts(JSON.parse(text)); } catch { return []; }
}
