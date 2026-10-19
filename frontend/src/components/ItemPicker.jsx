// Medicine name box with stock suggestions (searches item, Tablet Name and Generic Name).
// Each suggestion shows only the Tablet Name, with the Generic Name below in small text.
// Free text is allowed (item_id stays empty).
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
          {items.map((i) => {
            const title = i.brand_name || i.name;           // Tablet Name, else the item name
            return (
              <li key={i.id}>
                <button type="button" onClick={() => { setText(title); setOpen(false); onPick({ medicine_name: title, item_id: i.id, item: i }); }}>
                  <span className="pick-names">
                    <span className="pick-title">{title}</span>
                    {i.generic_name && <span className="pick-generic">{i.generic_name}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
