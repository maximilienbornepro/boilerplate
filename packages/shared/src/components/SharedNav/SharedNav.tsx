import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { APPS } from './constants.js';
import { MenuIcon, LogoutIcon } from './icons.js';
import './SharedNav.css';

export interface SharedNavProps {
  currentApp?: string;
  children?: ReactNode;
  /** If provided, only show these app IDs in the menu */
  allowedAppIds?: string[];
  /** If provided, use SPA navigation instead of full page reload */
  onNavigate?: (path: string) => void;
  /** Extra drawer entries shown above "Réglages". Intended for admin-only
   *  pages — the caller is responsible for gating visibility. */
  extraDrawerLinks?: Array<{ label: string; path: string; icon?: ReactNode; color?: string }>;
}

export function SharedNav({
  currentApp,
  allowedAppIds,
  onNavigate,
  extraDrawerLinks,
}: SharedNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Add/remove has-shared-nav class on body
  useEffect(() => {
    document.body.classList.add('has-shared-nav');
    return () => {
      document.body.classList.remove('has-shared-nav');
    };
  }, []);

  // Block body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // Close drawer on ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      setDrawerOpen(false);
      onNavigate(path);
    } else {
      setDrawerOpen(false);
    }
  };

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/';
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, []);

  // Filter apps for menu (exclude design-system, settings — they're separate)
  const menuApps = APPS.filter(app =>
    app.id !== 'design-system' && (!allowedAppIds || allowedAppIds.includes(app.id))
  );

  return (
    <>
      <nav className="shared-nav">
        {/* Left: terminal logo only */}
        <div className="shared-nav-left">
          <a
            className="shared-nav-logo-link"
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
            title="Accueil"
          >
            <span className="shared-nav-logo-terminal" aria-label="Boilerplate">&gt;_</span>
          </a>
        </div>

        {/* Right: burger menu toggle */}
        <div className="shared-nav-right">
          <button
            className="shared-nav-menu-toggle"
            onClick={() => setDrawerOpen(true)}
            type="button"
            title="Menu"
            aria-label="Ouvrir le menu"
          >
            <MenuIcon />
          </button>
        </div>
      </nav>

      {/* Full-screen drawer */}
      <div
        ref={drawerRef}
        className={`shared-nav-drawer${drawerOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!drawerOpen}
      >
        {/* Drawer header: logo + close */}
        <div className="shared-nav-drawer-header">
          <a
            className="shared-nav-logo-link"
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
            title="Accueil"
          >
            <span className="shared-nav-logo-terminal" aria-label="Boilerplate">&gt;_</span>
          </a>
          <button
            className="shared-nav-drawer-close"
            onClick={() => setDrawerOpen(false)}
            type="button"
            title="Fermer le menu"
            aria-label="Fermer le menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drawer content: app list */}
        <div className="shared-nav-drawer-content">
          <ul className="shared-nav-drawer-list">
            {menuApps.map(app => (
              <li key={app.id}>
                <a
                  className={`shared-nav-drawer-item${currentApp === app.id ? ' active' : ''}`}
                  href={app.path}
                  onClick={(e) => handleNavClick(e, app.path)}
                >
                  <span className="shared-nav-drawer-icon">
                    <span
                      className="shared-nav-drawer-dot"
                      style={{ backgroundColor: app.color }}
                    />
                  </span>
                  <span className="shared-nav-drawer-name">{app.name}</span>
                </a>
              </li>
            ))}
          </ul>

          {/* Extra admin entries (Logs IA, etc.) */}
          {extraDrawerLinks && extraDrawerLinks.length > 0 && (
            <>
              <hr className="shared-nav-drawer-sep" aria-hidden="true" />
              <ul className="shared-nav-drawer-list shared-nav-drawer-list-compact">
              {extraDrawerLinks.map(link => (
                <li key={link.path}>
                  <a
                    className="shared-nav-drawer-item shared-nav-drawer-item-compact"
                    href={link.path}
                    onClick={(e) => handleNavClick(e, link.path)}
                  >
                    {link.icon && (
                      <span className="shared-nav-drawer-icon">
                        {link.icon}
                      </span>
                    )}
                    <span className="shared-nav-drawer-name">{link.label}</span>
                  </a>
                </li>
              ))}
              </ul>
            </>
          )}

          <hr className="shared-nav-drawer-sep" aria-hidden="true" />
          {/* Settings (separated, no bullet, gear icon) */}
          <a
            className="shared-nav-drawer-settings"
            href="/reglages"
            onClick={(e) => handleNavClick(e, '/reglages')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Réglages</span>
          </a>
        </div>

        {/* Drawer footer: logout */}
        <div className="shared-nav-drawer-footer">
          <button
            className="shared-nav-drawer-logout"
            onClick={handleLogout}
            type="button"
          >
            <LogoutIcon />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="shared-nav-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}

export default SharedNav;
