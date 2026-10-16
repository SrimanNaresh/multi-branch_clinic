import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from '../i18n/en.js';
import ta from '../i18n/ta.js';

const DICTS = { en, ta };
const LangContext = createContext(null);

function initialLang() {
  try { return localStorage.getItem('sc_lang') === 'ta' ? 'ta' : 'en'; } catch { return 'en'; }
}

export function LangProvider({ children }) {
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem('sc_lang', lang); } catch { /* ignore */ }
  }, [lang]);

  // t('queue.token', { n: 5 }) → "Token 5"; falls back to English, then to the key
  const t = useCallback((key, vars) => {
    let s = DICTS[lang][key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, toggle: () => setLang((l) => (l === 'en' ? 'ta' : 'en')) }), [lang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useT = () => useContext(LangContext);
