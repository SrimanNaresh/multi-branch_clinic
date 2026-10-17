// Doctor time slots – several rows, each: start, end, appointment length and an optional break.
// Rules live in shared/timeSlots.js so the API checks exactly the same thing.
import { useT } from '../lib/i18n.jsx';
import { appointmentCount, checkTimeSlots } from '../../../shared/timeSlots.js';
import { Button, Card } from './ui.jsx';
import Icon from './Icon.jsx';

export const EMPTY_SLOT = { start_time: '', end_time: '', slot_minutes: 15, break_start: '', break_end: '' };

/** { [row]: { [field]: code } } – first problem per field */
export function slotErrors(slots) {
  const map = {};
  for (const e of checkTimeSlots(slots).errors) {
    map[e.row] ??= {};
    map[e.row][e.field] ??= e.code;
  }
  return map;
}

export default function TimeSlots({ value, onChange, showErrors }) {
  const { t } = useT();
  const errors = slotErrors(value);
  const set = (i, field, v) => onChange(value.map((s, j) => (j === i ? { ...s, [field]: v } : s)));
  const add = () => {
    const last = value[value.length - 1];
    // next row starts where the last one ended
    onChange([...value, { ...EMPTY_SLOT, start_time: last?.end_time || '', slot_minutes: last?.slot_minutes || 15 }]);
  };
  const remove = (i) => onChange(value.filter((_, j) => j !== i));

  const cell = (i, field, label, props = {}) => {
    const code = errors[i]?.[field];
    const shown = code && (showErrors || value[i][field] !== EMPTY_SLOT[field]);
    return (
      <label className={`field ${shown ? 'has-error' : ''}`}>
        <span className="field-label">{label}</span>
        <input value={value[i][field] ?? ''} onChange={(e) => set(i, field, e.target.value)} {...props} />
        {shown && <small className="field-error">{t(`slots.err.${code}`)}</small>}
      </label>
    );
  };

  return (
    <Card title={t('slots.title')}
      actions={<Button type="button" variant="ghost" size="sm" onClick={add}><Icon name="plus" size={15} /> {t('slots.add')}</Button>}>
      {!value.length && <p className="muted">{t('slots.none')}</p>}
      {value.map((s, i) => (
        <div className="slot-row" key={i}>
          <span className="slot-no">{i + 1}</span>
          {cell(i, 'start_time', t('slots.start'), { type: 'time', required: true })}
          {cell(i, 'end_time', t('slots.end'), { type: 'time', required: true })}
          {cell(i, 'slot_minutes', t('slots.duration'), { type: 'number', min: 5, max: 480, step: 5, inputMode: 'numeric', required: true })}
          {cell(i, 'break_start', t('slots.breakStart'), { type: 'time' })}
          {cell(i, 'break_end', t('slots.breakEnd'), { type: 'time' })}
          <div className="slot-side">
            {!errors[i] && <span className="muted small">{t('slots.count', { n: appointmentCount(s) })}</span>}
            <button type="button" className="icon-btn" title={t('slots.remove')} aria-label={t('slots.remove')} onClick={() => remove(i)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      ))}
      <p className="muted small slot-hint">{t('slots.hint')}</p>
    </Card>
  );
}
