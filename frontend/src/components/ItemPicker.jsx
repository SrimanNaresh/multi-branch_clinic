// Medicine name box with stock suggestions (searches item, Tablet Name and Generic Name).
// Each suggestion shows only the Tablet Name, with the Generic Name below in small text.
// Free text is allowed (item_id stays empty).
// Keyboard: ↑ / ↓ move through the suggestions, Enter picks, Esc closes.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useDebounced } from './ui.jsx';

export default function ItemPicker({ value, onPick, placeholder, ariaLabel }) {
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(-1);       // highlighted suggestion, -1 = none
  const dq = useDebounced(text, 200);
  const box = useRef(null);
  const menu = useRef(null);
  const menuId = useId();

  useEffect(() => setText(value || ''), [value]);

  useEffect(() => {
    if (!open || dq.trim().length < 1) { setItems([]); return; }
    let live = true;
    api('/items', { query: { q: dq.trim(), status: 'active', limit: 8 } })
      .then((r) => live && setItems(r.rows))
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [dq, open]);

  // new suggestions: nothing highlighted until an arrow key is pressed
  useEffect(() => setActive(-1), [items]);

  // keep the highlighted suggestion visible inside the scrolling menu
  useEffect(() => {
    if (active >= 0) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const titleOf = (i) => i.brand_name || i.name;     // Tablet Name, else the item name
  const pick = (i) => {
    const title = titleOf(i);
    setText(title); setOpen(false); setActive(-1);
    onPick({ medicine_name: title, item_id: i.id, item: i });
  };

  const showMenu = open && items.length > 0;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showMenu) { setOpen(true); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? items.length - 1 : (a + step + items.length) % items.length));
    } else if (e.key === 'Enter' && showMenu && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape' && showMenu) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="picker" ref={box}>
      <input
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={showMenu}
        aria-controls={menuId}
        aria-autocomplete="list"
        aria-activedescendant={showMenu && active >= 0 ? `${menuId}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(e) => { setText(e.target.value); setOpen(true); onPick({ medicine_name: e.target.value, item_id: null }); }}
      />
      {showMenu && (
        <ul className="picker-menu" id={menuId} role="listbox" ref={menu}>
          {items.map((i, idx) => (
            <li key={i.id} id={`${menuId}-${idx}`} role="option" aria-selected={idx === active}>
              <button type="button" tabIndex={-1} className={idx === active ? 'active' : ''}
                onMouseEnter={() => setActive(idx)} onClick={() => pick(i)}>
                <span className="pick-names">
                  <span className="pick-title">{titleOf(i)}</span>
                  {i.generic_name && <span className="pick-generic">{i.generic_name}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
