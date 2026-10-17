// Doctor time slots – checked the same way by the UI (as you type) and the API (before saving).
// A slot row: start_time, end_time ('HH:MM'), slot_minutes (length of one appointment)
// and an optional break (break_start, break_end) that must lie inside start–end.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

// English messages; the UI shows its own translation of each code (slots.err.<code>).
export const SLOT_ERRORS = {
  start: 'enter a start time',
  end: 'enter an end time',
  order: 'end time must be after start time',
  duration: 'duration must be 5–480 minutes',
  durationFit: 'duration is longer than the working time',
  breakBoth: 'enter both break start and break end',
  breakOrder: 'break end must be after break start',
  breakInside: 'break must be between start time and end time',
  overlap: 'overlaps another time slot',
};

const clean = (v) => (v == null ? '' : String(v).trim().slice(0, 5));

/** Number of appointments a valid row gives (time before the break + time after it). */
export function appointmentCount(s) {
  const start = toMinutes(s.start_time);
  const end = toMinutes(s.end_time);
  const dur = Number(s.slot_minutes);
  if (s.break_start && s.break_end) {
    return Math.floor((toMinutes(s.break_start) - start) / dur) + Math.floor((end - toMinutes(s.break_end)) / dur);
  }
  return Math.floor((end - start) / dur);
}

/**
 * @returns {{ slots: object[], errors: { row: number, field: string, code: string }[] }}
 * slots are normalised ('HH:MM', integer minutes, null when no break); row is 0-based.
 */
export function checkTimeSlots(input) {
  const rows = Array.isArray(input) ? input : [];
  const slots = [];
  const errors = [];
  rows.forEach((s, row) => {
    const err = (field, code) => errors.push({ row, field, code });
    const start = clean(s.start_time);
    const end = clean(s.end_time);
    const bStart = clean(s.break_start);
    const bEnd = clean(s.break_end);
    const dur = Number(s.slot_minutes);
    const before = errors.length;

    if (!TIME.test(start)) err('start_time', 'start');
    if (!TIME.test(end)) err('end_time', 'end');
    if (!Number.isInteger(dur) || dur < 5 || dur > 480) err('slot_minutes', 'duration');
    if (errors.length === before && toMinutes(end) <= toMinutes(start)) err('end_time', 'order');

    const hasBreak = bStart || bEnd;
    if (hasBreak) {
      if (!TIME.test(bStart)) err('break_start', 'breakBoth');
      if (!TIME.test(bEnd)) err('break_end', 'breakBoth');
    }
    if (errors.length > before) return;

    let breakLen = 0;
    if (hasBreak) {
      if (toMinutes(bEnd) <= toMinutes(bStart)) return err('break_end', 'breakOrder');
      if (toMinutes(bStart) < toMinutes(start) || toMinutes(bEnd) > toMinutes(end)) return err('break_start', 'breakInside');
      breakLen = toMinutes(bEnd) - toMinutes(bStart);
    }
    if (dur > toMinutes(end) - toMinutes(start) - breakLen) return err('slot_minutes', 'durationFit');

    slots.push({ row, start_time: start, end_time: end, slot_minutes: dur,
      break_start: hasBreak ? bStart : null, break_end: hasBreak ? bEnd : null });
  });

  // valid rows must not overlap each other
  const sorted = [...slots].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start_time) < toMinutes(sorted[i - 1].end_time)) {
      errors.push({ row: sorted[i].row, field: 'start_time', code: 'overlap' });
    }
  }
  return { slots: slots.map(({ row, ...s }) => s), errors };
}
