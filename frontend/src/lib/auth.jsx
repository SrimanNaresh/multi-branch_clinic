import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, session } from './api.js';
import { can as canRole, isGlobalRole } from '../../../shared/permissions.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [activeClinicId, setActiveClinicIdState] = useState(session.clinicId);
  const [loading, setLoading] = useState(!!session.token);

  const logout = useCallback(() => {
    session.setToken(null);
    session.setClinicId(null);
    setUser(null);
    setClinics([]);
    setActiveClinicIdState(null);
  }, []);

  useEffect(() => session.onUnauthorized(logout), [logout]);

  const loadClinics = useCallback(async () => {
    const res = await api('/clinics', { clinic: null });
    setClinics(res.rows);
    return res.rows;
  }, []);

  const bootstrap = useCallback(async (u) => {
    setUser(u);
    if (isGlobalRole(u.role)) {
      const list = await loadClinics();
      // keep the last chosen clinic if it still exists, otherwise "All clinics"
      const keep = list.find((c) => String(c.id) === String(session.clinicId));
      const id = keep ? String(keep.id) : null;
      session.setClinicId(id);
      setActiveClinicIdState(id);
    } else {
      setClinics(u.clinic_id ? [{ id: u.clinic_id, name: u.clinic_name, code: u.clinic_code, status: 'active' }] : []);
      session.setClinicId(null);                     // branch users: the server uses their own clinic
      setActiveClinicIdState(u.clinic_id ? String(u.clinic_id) : null);
    }
  }, [loadClinics]);

  useEffect(() => {
    if (!session.token) return;
    api('/auth/me')
      .then((r) => bootstrap(r.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [bootstrap, logout]);

  const login = useCallback(async (username, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password }, clinic: null });
    session.setToken(r.token);
    await bootstrap(r.user);
    return r.user;
  }, [bootstrap]);

  const setActiveClinic = useCallback((id) => {
    const v = id && id !== 'all' ? String(id) : null;
    session.setClinicId(v);
    setActiveClinicIdState(v);
  }, []);

  const value = useMemo(() => {
    const isGlobal = !!user && isGlobalRole(user.role);
    const activeClinic = clinics.find((c) => String(c.id) === String(activeClinicId)) || null;
    return {
      user, loading, clinics, isGlobal, activeClinic, activeClinicId,
      login, logout, setActiveClinic, reloadClinics: loadClinics,
      can: (perm) => !!user && canRole(user.role, perm),
    };
  }, [user, loading, clinics, activeClinicId, login, logout, setActiveClinic, loadClinics]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
