// Column choices for a wide entry grid (Three in One): which columns are shown and how wide each one is.
// Kept on this PC (localStorage), per grid. Columns are { key, w (width share), group?, extra?, fixed? }:
//  - fixed columns are always shown; extra columns start hidden (the group's › shows them);
//  - a column can be hidden / shown from the Columns list, and widened by dragging its heading's right edge.
import { useCallback, useState } from 'react';

const load = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
};
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

export function useGridColumns(storageKey, cols) {
  const defaultHidden = () => cols.filter((c) => c.extra).map((c) => c.key);
  const [hidden, setHiddenState] = useState(() => new Set(load(`${storageKey}.hidden`, defaultHidden())));
  const [widths, setWidthsState] = useState(() => load(`${storageKey}.widths`, {}));

  // updates take the latest choice (fn(prev) → next), so two quick clicks don't undo each other
  const updateHidden = useCallback((fn) => setHiddenState((prev) => {
    const next = fn(prev);
    save(`${storageKey}.hidden`, [...next]);
    return next;
  }), [storageKey]);
  const setWidths = useCallback((next) => { setWidthsState(next); save(`${storageKey}.widths`, next); }, [storageKey]);

  const isHidden = (key) => hidden.has(key);
  /** Show / hide one column */
  const toggle = (key) => updateHidden((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  /** Show / hide some columns together */
  const showCols = (keys, show) => updateHidden((prev) => { const n = new Set(prev); keys.forEach((k) => (show ? n.delete(k) : n.add(k))); return n; });
  /** A group's ›: open = all its extra columns shown */
  const groupOpen = (group) => cols.filter((c) => c.group === group && c.extra).every((c) => !hidden.has(c.key));
  const toggleGroup = (group) => {
    const keys = cols.filter((c) => c.group === group && c.extra).map((c) => c.key);
    updateHidden((prev) => {
      const open = keys.every((k) => !prev.has(k));
      const n = new Set(prev);
      keys.forEach((k) => (open ? n.add(k) : n.delete(k)));
      return n;
    });
  };
  const resetColumns = () => updateHidden(() => new Set(defaultHidden()));

  const widthOf = (c) => Number(widths[c.key]) || c.w;
  const resetWidth = (key) => setWidthsState((prev) => { const n = { ...prev }; delete n[key]; save(`${storageKey}.widths`, n); return n; });
  const resetWidths = () => setWidths({});

  /**
   * Drag a heading's right edge: the column follows the pointer (the other columns share what is left).
   * visible = the columns shown now; table = the <table> element.
   */
  function startResize(e, key, visible, table) {
    if (!table) return;
    e.preventDefault();
    e.stopPropagation();
    const tableW = table.clientWidth;
    const total = visible.reduce((s, c) => s + widthOf(c), 0);
    const col = visible.find((c) => c.key === key);
    const w0 = widthOf(col);
    const p0 = (w0 / total) * tableW;
    const others = total - w0;
    const startX = e.clientX;
    let latest = widths;
    const move = (ev) => {
      const p = Math.min(tableW * 0.6, Math.max(24, p0 + (ev.clientX - startX)));
      const w = Math.round(((p * others) / (tableW - p)) * 100) / 100;
      latest = { ...widths, [key]: w };
      setWidthsState(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
      save(`${storageKey}.widths`, latest);
    };
    document.body.classList.add('col-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return { isHidden, toggle, showCols, groupOpen, toggleGroup, resetColumns, widthOf, resetWidth, resetWidths, startResize };
}
