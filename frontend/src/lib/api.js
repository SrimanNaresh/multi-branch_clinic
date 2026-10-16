// Thin fetch wrapper: adds the token and the active clinic (X-Clinic-Id) to every call.
const BASE = (import.meta.env && import.meta.env.VITE_API_URL) || '/api';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let token = store.get('sc_token');
let clinicId = store.get('sc_clinic');           // admins only: the clinic picked in the switcher
let onUnauthorized = () => {};

export const session = {
  get token() { return token; },
  setToken(t) { token = t; store.set('sc_token', t); },
  get clinicId() { return clinicId; },
  setClinicId(id) { clinicId = id == null ? null : String(id); store.set('sc_clinic', clinicId); },
  onUnauthorized(fn) { onUnauthorized = fn; },
};

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * api('/patients', { query: { q: 'ram' } })
 * api('/patients', { method: 'POST', body: {...} })
 * Pass clinic: 'all' (or null) to skip the clinic header for that call.
 */
export async function api(path, { method = 'GET', body, query, clinic } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`;

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const cid = clinic !== undefined ? clinic : clinicId;
  if (cid && cid !== 'all') headers['X-Clinic-Id'] = String(cid);

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0, 'NETWORK');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const e = data?.error || {};
    throw new ApiError(e.message || `Request failed (${res.status})`, res.status, e.code, e.details);
  }
  return data;
}
