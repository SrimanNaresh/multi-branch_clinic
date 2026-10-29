// Vendor Name box (Pharmacy → Purchase / Order): type to search the clinic's vendors, pick one, or
// "+ Add vendor" at the bottom of the list (the typed text becomes the new vendor's name).
// Keyboard: ↑ / ↓ move through the list, Enter picks (or adds when nothing matches), Esc closes.
// No onAdd (Stock In): only existing vendors, no "+ Add vendor" row.
// addon: shown to the right of the box (Purchase / Order: the arrow that shows / hides Details).
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../lib/i18n.jsx';

export default function VendorPicker({ vendors, value, onPick, onAdd, label, required, addon }) {
  const { t } = useT();
  const picked = vendors.find((v) => String(v.id) === String(value));
  const [text, setText] = useState(picked?.name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const menuId = useId();

  // show the chosen vendor's name (also after it is chosen from outside, e.g. just added)
  useEffect(() => { setText(picked?.name || ''); }, [picked?.id, picked?.name]);

  useEffect(() => {
    const close = (e) => {
      if (box.current && !box.current.contains(e.target)) { setOpen(false); setText(picked?.name || ''); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picked?.name]);

  const q = text.trim().toLowerCase();
  const typing = q && q !== (picked?.name || '').toLowerCase();
  const shown = typing ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
  useEffect(() => setActive(-1), [q, open]);

  const pick = (v) => { onPick(v); setText(v.name); setOpen(false); };
  const add = () => { setOpen(false); onAdd(typing ? text.trim() : ''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const n = shown.length + (onAdd ? 1 : 0);       // + the "Add vendor" row
      if (!n) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n - 1 : a - 1)));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active >= 0 && active < shown.length) pick(shown[active]);
      else if (onAdd && (active === shown.length || !shown.length)) add();
      else if (shown[0]) pick(shown[0]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <label className="field">
      <span className="field-label">{label}{required && <b className="req"> *</b>}</span>
      <div className="vendor-row">
        <div className="picker" ref={box}>
          <input className="combo-input" value={text} placeholder={t('purchase.vendorHint')} aria-label={label} autoComplete="off"
            role="combobox" aria-expanded={open} aria-controls={menuId} aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${menuId}-${active}` : undefined}
            onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKeyDown}
            onChange={(e) => { setText(e.target.value); setOpen(true); }} />
          {open && (
            <ul className="picker-menu picker-browse" id={menuId} role="listbox">
              {shown.map((v, i) => (
                <li key={v.id} id={`${menuId}-${i}`} role="option" aria-selected={i === active}>
                  <button type="button" tabIndex={-1} className={i === active ? 'active' : ''}
                    onMouseEnter={() => setActive(i)} onClick={() => pick(v)}>
                    <span className="pick-names">
                      <span className="pick-title">{v.name}</span>
                      {v.mobile && <span className="pick-generic">{v.mobile}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="muted vendor-none">{t('purchase.noVendor')}</li>}
              {onAdd && (
                <li id={`${menuId}-${shown.length}`} role="option" aria-selected={active === shown.length}>
                  <button type="button" tabIndex={-1} className={`pick-add ${active === shown.length ? 'active' : ''}`}
                    onMouseEnter={() => setActive(shown.length)} onClick={add}>
                    + {typing ? t('purchase.addVendorNamed', { name: text.trim() }) : t('purchase.addVendor')}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
        {addon}
      </div>
    </label>
  );
}
