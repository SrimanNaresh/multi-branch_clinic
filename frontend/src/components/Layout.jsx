import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useT } from '../lib/i18n.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { MENU, menuLinks } from '../menu.js';
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

// Menu groups this user can see, shared by the left menu and the horizontal menu bar.
// locked: an admin has not picked a clinic yet, so the clinic menus are not shown.
function useMenu(path) {
  const auth = useAuth();
  const branchReady = !!auth.activeClinic;

  // a sub-menu keeps only the pages this user may open, and is dropped when none are left
  const allowed = (items) => items
    .map((i) => (i.children ? { ...i, children: i.children.filter((c) => auth.can(c.perm)) } : i))
    .filter((i) => (i.children ? i.children.length : auth.can(i.perm)));
  const groups = MENU.map((g) => ({ ...g, items: allowed(g.items) }))
    .filter((g) => g.items.length && (g.scope === 'main' ? auth.isGlobal : true));

  // Highlight the most specific menu path that matches the current page
  const activePath = groups.flatMap((g) => menuLinks(g.items).map((i) => i.path))
    .filter((p) => path === p || path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (p) => p === activePath;
  const hasActive = (i) => (i.children ? i.children.some((c) => isActive(c.path)) : isActive(i.path));

  return {
    groups: groups.filter((g) => !(g.scope === 'branch' && auth.isGlobal && !branchReady)),
    locked: auth.isGlobal && !branchReady,
    isActive,
    hasActive,
  };
}

/** Left menu sub-menu (Pharmacy → Item → Master / List): click to open or close; opens itself on its own pages. */
function NavSub({ item, isActive, current, onClose }) {
  const { t } = useT();
  const [open, setOpen] = useState(current);
  useEffect(() => { if (current) setOpen(true); }, [current]);
  return (
    <div className="nav-sub">
      <button type="button" className={`nav-item nav-sub-btn ${current ? 'current' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={item.icon} /> <span>{t(item.label)}</span>
        <Icon name="chevronDown" size={14} className={`nav-sub-arrow ${open ? 'open' : ''}`} />
      </button>
      {open && item.children.map((c) => (
        <Link key={c.path} to={c.path} className={`nav-item nav-child ${isActive(c.path) ? 'active' : ''}`} onClick={onClose}>
          <span>{t(c.label)}</span>
        </Link>
      ))}
    </div>
  );
}

function Sidebar({ path, open, onClose }) {
  const auth = useAuth();
  const { t } = useT();
  const { groups, locked, isActive, hasActive } = useMenu(path);

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <nav>
          {groups.map((g) => (
            <div key={g.id} className="nav-group">
              <div className="nav-title">
                {t(g.label)}
                {g.scope === 'branch' && auth.activeClinic && <span className="nav-clinic">{auth.activeClinic.code}</span>}
              </div>
              {g.items.map((i) => (i.children ? (
                <NavSub key={i.id} item={i} isActive={isActive} current={hasActive(i)} onClose={onClose} />
              ) : (
                <Link key={i.path} to={i.path} className={`nav-item ${isActive(i.path) ? 'active' : ''}`} onClick={onClose}>
                  <Icon name={i.icon} /> <span>{t(i.label)}</span>
                </Link>
              )))}
            </div>
          ))}
          {locked && (
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

/**
 * A wide drop-down (Pharmacy) is centred on the window, as wide as it needs up to the window width
 * less 16px each side; its columns wrap onto a second row only when even that is too narrow.
 */
const fitToScreen = (el) => {
  if (!el) return;
  const vw = document.documentElement.clientWidth;
  el.style.maxWidth = `${vw - 32}px`;
  const parentLeft = el.parentElement.getBoundingClientRect().left;
  el.style.left = `${(vw - el.getBoundingClientRect().width) / 2 - parentLeft}px`;
};

// Horizontal menu bar under the header: one button per group, its pages open in a drop-down.
// While one drop-down is open, moving the mouse to another group opens that one instead.
function TopNav({ path }) {
  const { t } = useT();
  const { groups, locked, isActive, hasActive } = useMenu(path);
  const [openId, setOpenId] = useState(null);
  const bar = useRef(null);

  useEffect(() => setOpenId(null), [path]);
  useEffect(() => {
    if (!openId) return undefined;
    const close = (e) => { if (bar.current && !bar.current.contains(e.target)) setOpenId(null); };
    const esc = (e) => { if (e.key === 'Escape') setOpenId(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [openId]);

  return (
    <nav className="topnav" ref={bar} aria-label={t('topbar.menu')}>
      {groups.map((g) => {
        const isOpen = openId === g.id;
        const current = g.items.some(hasActive);
        const mega = g.items.some((i) => i.children);
        return (
          <div key={g.id} className="topnav-group" onMouseEnter={() => { if (openId && !isOpen) setOpenId(g.id); }}>
            <button type="button" className={`topnav-btn ${current ? 'current' : ''} ${isOpen ? 'open' : ''}`}
              aria-expanded={isOpen} aria-haspopup="true" onClick={() => setOpenId(isOpen ? null : g.id)}>
              {t(g.label)} <Icon name="chevronDown" size={14} />
            </button>
            {isOpen && (
              <div className={`topnav-menu ${mega ? 'topnav-mega' : ''}`} ref={mega ? fitToScreen : undefined}>
                {/* sub-menus sit side by side, one column each, their pages listed under the heading */}
                {g.items.map((i) => (i.children ? (
                  // a sub-menu shows as a small heading with its pages under it
                  <div key={i.id} className="topnav-sub">
                    <div className="topnav-sub-title"><span className="topnav-sub-icon"><Icon name={i.icon} size={14} /></span> <span>{t(i.label)}</span></div>
                    {i.children.map((c) => (
                      <Link key={c.path} to={c.path} className={`topnav-item topnav-child ${isActive(c.path) ? 'active' : ''}`} onClick={() => setOpenId(null)}>
                        <span>{t(c.label)}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Link key={i.path} to={i.path} className={`topnav-item ${isActive(i.path) ? 'active' : ''}`} onClick={() => setOpenId(null)}>
                    <Icon name={i.icon} size={16} /> <span>{t(i.label)}</span>
                  </Link>
                )))}
              </div>
            )}
          </div>
        );
      })}
      {locked && <span className="topnav-hint">{t('nav.selectClinicHint')}</span>}
    </nav>
  );
}

// The header (Ayush Pro logo + top bar) is fixed across the top.
// Wide screens: the menu button switches between the left menu and the horizontal menu bar
// (remembered on this browser). Narrow screens: the menu is a drawer and the same button opens it.
const MENU_MODE_KEY = 'sc_menu_mode';
const NARROW = '(max-width: 900px)';
const readMenuMode = () => { try { return localStorage.getItem(MENU_MODE_KEY) === 'top' ? 'top' : 'side'; } catch { return 'side'; } };

export default function Layout({ path, children }) {
  const auth = useAuth();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [menuMode, setMenuMode] = useState(readMenuMode);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);

  const toggleMenu = () => {
    if (window.matchMedia(NARROW).matches) { setOpen(true); return; }
    const mode = menuMode === 'top' ? 'side' : 'top';
    setMenuMode(mode);
    try { localStorage.setItem(MENU_MODE_KEY, mode); } catch { /* private mode: not remembered */ }
  };
  const menuLabel = menuMode === 'top' ? t('topbar.menuSide') : t('topbar.menuTop');

  return (
    <div className={`shell menu-${menuMode}`}>
      <header className="app-header">
        <div className="brand header-brand">
          <div className="brand-mark"><img src="/logo-128.png" alt="" /></div>
          <div className="brand-text">
            <strong>Ayush Pro</strong>
            <small>SmartClinic</small>
          </div>
          {/* at the right end of the logo column, above the menu's scroll bar */}
          <button className="icon-btn hamburger" onClick={toggleMenu} aria-label={menuLabel} title={menuLabel}>
            <Icon name="menu" size={22} />
          </button>
        </div>
        <div className="topbar">
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
        </div>
      </header>
      {menuMode === 'top' && <TopNav path={path} />}
      <div className="app-body">
        <Sidebar path={path} open={open} onClose={() => setOpen(false)} />
        <main className="content main">{children}</main>
      </div>
    </div>
  );
}
