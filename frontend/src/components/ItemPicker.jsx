// Medicine name box with stock suggestions. Free text is allowed (item_id stays empty).
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useDebounced } from './ui.jsx';

export default function ItemPicker({ value, onPick, placeholder, ariaLabel }) {
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const dq = useDebounced(text, 200);
  const box = useRef(null);

  useEffect(() => setText(value || ''), [value]);

  useEffect(() => {
    if (!open || dq.trim().length < 1) { setItems([]); return; }
    let live = true;
    api('/items', { query: { q: dq.trim(), status: 'active', limit: 8 } })
      .then((r) => live && setItems(r.rows))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [dq, open]);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="picker" ref={box}>
      <input
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); onPick({ medicine_name: e.target.value, item_id: null }); }}
      />
      {open && items.length > 0 && (
        <ul className="picker-menu">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => { setText(i.name); setOpen(false); onPick({ medicine_name: i.name, item_id: i.id, item: i }); }}>
                <span>{i.name}</span>
                <small className={Number(i.stock_qty) <= Number(i.reorder_level) ? 'low' : 'muted'}>
                  {i.category ? `${i.category} · ` : ''}{i.stock_qty} {i.unit}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
