import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useT } from '../lib/i18n.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { MENU } from '../menu.js';
import Icon from './Icon.jsx';

export function LangToggle({ className = '' }) {
  const { lang, setLang } = useT();
  return (
    <div className={`lang-toggle ${className}`} role="group" aria-label="Language">
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      <button className={lang === 'ta' ? 'on' : ''} onClick={() => setLang('ta')}>தமிழ்</button>
    </div>
  );
}

function ClinicSwitcher() {
  const auth = useAuth();
  const { t } = useT();
  if (!auth.isGlobal) {
    return (
      <div className="clinic-chip" title={t('topbar.yourClinic')}>
        <Icon name="building" size={16} /> {auth.user.clinic_name} <span className="muted">({auth.user.clinic_code})</span>
      </div>
    );
  }
  return (
    <label className="clinic-switcher">
      <Icon name="building" size={16} />
      <span className="sr-only">{t('topbar.switchClinic')}</span>
      <select
        value={auth.activeClinicId || 'all'}
        onChange={(e) => auth.setActiveClinic(e.target.value)}
        aria-label={t('topbar.switchClinic')}
      >
        <option value="all">{t('topbar.allClinics')}</option>
        {auth.clinics.map((c) => (
          <option key={c.id} value={c.id} disabled={c.status !== 'active'}>
            {c.name} ({c.code}){c.status !== 'active' ? ` – ${t('status.inactive')}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function Sidebar({ path, open, onClose }) {
  const auth = useAuth();
  const { t } = useT();
  const branchReady = !!auth.activeClinic;

  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => auth.can(i.perm)) }))
    .filter((g) => g.items.length && (g.scope === 'main' ? auth.isGlobal : true));

  // Highlight the most specific menu path that matches the current page
  const activePath = groups.flatMap((g) => g.items.map((i) => i.path))
    .filter((p) => path === p || path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (p) => p === activePath;

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Ayush Pro</strong>
            <small>SmartClinic</small>
          </div>
        </div>
        <nav>
          {groups.filter((g) => !(g.scope === 'branch' && auth.isGlobal && !branchReady)).map((g) => (
            <div key={g.id} className="nav-group">
              <div className="nav-title">
                {t(g.label)}
                {g.scope === 'branch' && auth.activeClinic && <span className="nav-clinic">{auth.activeClinic.code}</span>}
              </div>
              {g.items.map((i) => (
                <Link key={i.path} to={i.path} className={`nav-item ${isActive(i.path) ? 'active' : ''}`} onClick={onClose}>
                  <Icon name={i.icon} /> <span>{t(i.label)}</span>
                </Link>
              ))}
            </div>
          ))}
          {auth.isGlobal && !branchReady && (
            <div className="nav-group locked">
              <div className="nav-title">{t('nav.clinicMenus')}</div>
              <p className="nav-hint">{t('nav.selectClinicHint')}</p>
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}

export default function Layout({ path, children }) {
  const auth = useAuth();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);

  return (
    <div className="shell">
      <Sidebar path={path} open={open} onClose={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setOpen(true)} aria-label={t('topbar.menu')}>
            <Icon name="menu" size={22} />
          </button>
          <ClinicSwitcher />
          <div className="topbar-right">
            <LangToggle />
            <div className="user-menu">
              <button className="user-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
                <span className="avatar">{auth.user.name.slice(0, 1).toUpperCase()}</span>
                <span className="user-meta">
                  <strong>{auth.user.name}</strong>
                  <small>{t(`role.${auth.user.role}`)}</small>
                </span>
              </button>
              {menu && (
                <div className="dropdown">
                  <button onClick={() => navigate('/profile')}><Icon name="key" /> {t('profile.changePassword')}</button>
                  <button onClick={auth.logout}><Icon name="logout" /> {t('topbar.logout')}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
