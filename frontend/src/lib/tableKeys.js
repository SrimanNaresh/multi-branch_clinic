// Keyboard moves inside an editable table: arrow keys go from box to box and row to row.

/**
 * Arrow keys in an editable item table (Purchase / Order, Stock In) – put on its <tbody onKeyDown>.
 * ← / →: move to the previous / next box or button, carrying on to the next / previous row at the ends.
 * In a text box (e.g. Item Name) the cursor moves through the text first and only leaves at its start / end.
 * ↑ / ↓: the same column in the row above / below (number boxes no longer step their value). In the Item
 * Name box they still move through the item list while it is open.
 */
export function arrowMove(e) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = e.target;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (el.getAttribute('aria-expanded') === 'true') return;       // Item Name list is open
    const cell = el.closest('td');
    const row = cell?.parentElement;
    const target = e.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling;
    if (!cell || !target) { if (el.type === 'number') e.preventDefault(); return; }
    const sameCol = target.children[[...row.children].indexOf(cell)];
    const stops = [...sameCol.querySelectorAll('input, button:not([tabindex="-1"])')];
    // + / delete sit in one cell: keep to the same button
    const next = stops[Math.max(0, [...cell.querySelectorAll('input, button:not([tabindex="-1"])')].indexOf(el))] || stops[0];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (next.tagName === 'INPUT') next.select();
    return;
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (el.type === 'text' || el.getAttribute('role') === 'combobox') {
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    if ((e.key === 'ArrowLeft' && !atStart) || (e.key === 'ArrowRight' && !atEnd)) return;
  }
  const stops = [...e.currentTarget.querySelectorAll('input, button:not([tabindex="-1"])')];
  const next = stops[stops.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (next.tagName === 'INPUT') next.select();
}
