// Tiny hash router (#/patients/12/edit) – no extra dependency, works on any static host.
import { useEffect, useState } from 'react';

function read() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function useLocation() {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onChange = () => setLoc(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return loc;
}

export function navigate(to, { replace = false } = {}) {
  const target = `#${to}`;
  if (replace) window.history.replaceState(null, '', target);
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = to;
}

export function Link({ to, children, ...rest }) {
  return <a href={`#${to}`} {...rest}>{children}</a>;
}

/** matchRoute('/patients/:id', '/patients/12') → { id: '12' } | null */
export function matchRoute(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
