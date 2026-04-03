import React, { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { APPS, CATEGORIES } from './constants.js';
import type { AppInfo } from './constants.js';
import { MenuIcon, HomeIcon, LogoutIcon } from './icons.js';
import './SharedNav.css';

export interface SharedNavProps {
  currentApp?: string;
  children?: ReactNode;
  /** If provided, only show these app IDs in the menu */
  allowedAppIds?: string[];
  /** If provided, use SPA navigation instead of full page reload */
  onNavigate?: (path: string) => void;
}

export function SharedNav({
  currentApp,
  children,
  allowedAppIds,
  onNavigate,
}: SharedNavProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const currentAppInfo: AppInfo | undefined = currentApp
    ? APPS.find(app => app.id === currentApp)
    : undefined;

  // Add/remove has-shared-nav class on body
  useEffect(() => {
    document.body.classList.add('has-shared-nav');
    return () => {
      document.body.classList.remove('has-shared-nav');
    };
  }, []);

  // Block body scroll when dropdown is open
  useEffect(() => {
    if (dropdownOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [dropdownOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      setDropdownOpen(false);
      onNavigate(path);
    } else {
      setDropdownOpen(false);
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

  return (
    <nav className="shared-nav">
      {/* Left: logo + brand */}
      <div className="shared-nav-left">
        <a
          className="shared-nav-logo-link"
          href="/"
          onClick={(e) => handleNavClick(e, '/')}
          title="Accueil"
        >
          <img
            src="/favicon.svg"
            alt="Boilerplate"
            className="shared-nav-logo"
          />
        </a>

        {currentAppInfo ? (
          <a
            className="shared-nav-brand"
            href={currentAppInfo.path}
            onClick={(e) => handleNavClick(e, currentAppInfo.path)}
          >
            <span
              className="shared-nav-brand-dot"
              style={{ backgroundColor: currentAppInfo.color }}
            />
            {currentAppInfo.name}
          </a>
        ) : (
          <a
            className="shared-nav-brand"
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
          >
            Boilerplate
          </a>
        )}
      </div>

      {/* Right: burger menu */}
      <div className="shared-nav-right" ref={menuContainerRef}>
        <button
          className="shared-nav-menu-toggle"
          onClick={() => setDropdownOpen(prev => !prev)}
          type="button"
          title="Menu"
        >
          <MenuIcon />
        </button>

        <div className={`shared-nav-dropdown${dropdownOpen ? ' open' : ''}`}>
          <a
            className="shared-nav-dropdown-home"
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
          >
            <HomeIcon />
            <span>Accueil</span>
          </a>

          {CATEGORIES.map((category) => {
            const categoryApps = APPS.filter(
              app => app.category === category.id && (!allowedAppIds || allowedAppIds.includes(app.id))
            );
            if (categoryApps.length === 0) return null;

            return (
              <React.Fragment key={category.id}>
                <div className="shared-nav-dropdown-category">
                  <span className="shared-nav-dropdown-category-icon">{category.icon}</span>
                  <span>{category.name}</span>
                </div>
                {categoryApps.map(app => (
                  <a
                    key={app.id}
                    className={`shared-nav-dropdown-item${
                      currentApp === app.id ? ' active' : ''
                    }`}
                    href={app.path}
                    onClick={(e) => handleNavClick(e, app.path)}
                  >
                    <span
                      className="shared-nav-dropdown-dot"
                      style={{ backgroundColor: app.color }}
                    />
                    <span className="shared-nav-dropdown-name">{app.name}</span>
                  </a>
                ))}
              </React.Fragment>
            );
          })}

          {/* Settings + Logout */}
          <div className="shared-nav-dropdown-divider" />

          <a
            className="shared-nav-dropdown-item"
            href="/reglages"
            onClick={(e) => handleNavClick(e, '/reglages')}
          >
            <span className="shared-nav-dropdown-icon">&#x2699;&#xFE0F;</span>
            <span className="shared-nav-dropdown-name">Réglages</span>
          </a>

          <button
            className="shared-nav-dropdown-logout"
            onClick={handleLogout}
            type="button"
          >
            <LogoutIcon />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

export default SharedNav;
