import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { APPS, type AppInfo } from '../SharedNav/constants.js';
import './AppSidebar.css';

/** An item listed under a module (a Planning, Board, Document…). */
export interface SidebarItem {
  id: string;
  label: string;
  path: string;
}

/** Per-module loader. Returns the items to list under the module when the
 * user expands it. Loaders are invoked lazily (only on first expand). */
export type ModuleLoader = () => Promise<SidebarItem[]>;

export interface AppSidebarProps {
  /** App IDs the current user is allowed to see (filters APPS). When
   * undefined, every app is shown (e.g. admin, or noAuth). */
  allowedAppIds?: string[];
  /** Map of moduleId → loader function. Modules without a loader just
   * navigate to their main page (no expand button). */
  moduleLoaders?: Record<string, ModuleLoader>;
  /** Current pathname (router-provided). Used to highlight the active
   * module / item. */
  currentPath: string;
  /** Called when the user picks any link. Parent does the navigation. */
  onNavigate: (path: string) => void;
  /** Optional footer (typically: theme toggle + user menu). */
  footer?: ReactNode;
}

const LS_COLLAPSED = 'boilerplate-sidebar-collapsed';
const LS_EXPANDED = 'boilerplate-sidebar-expanded-modules';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch { return fallback; }
}

function readArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

/**
 * Left sidebar that lists every app the user has access to + the items
 * created inside each module (plannings, boards, documents…). Collapsible
 * (persists via localStorage) so the main content can take the full width
 * when needed. Inspired by ClickUp / Notion side panels.
 */
export function AppSidebar({
  allowedAppIds,
  moduleLoaders = {},
  currentPath,
  onNavigate,
  footer,
}: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readBool(LS_COLLAPSED, false));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readArray(LS_EXPANDED)));
  const [itemsByModule, setItemsByModule] = useState<Record<string, SidebarItem[] | 'loading' | { error: string } | undefined>>({});

  // Visible apps = intersection with allowedAppIds (or all if undefined).
  const visibleApps = useMemo<AppInfo[]>(() => {
    if (!allowedAppIds) return APPS;
    const allowed = new Set(allowedAppIds);
    return APPS.filter(a => allowed.has(a.id));
  }, [allowedAppIds]);

  // Persist collapsed.
  useEffect(() => {
    try { localStorage.setItem(LS_COLLAPSED, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Persist expanded module ids.
  useEffect(() => {
    try { localStorage.setItem(LS_EXPANDED, JSON.stringify(Array.from(expanded))); } catch { /* ignore */ }
  }, [expanded]);

  // Lazy-load items for a module the first time it gets expanded.
  const ensureItemsLoaded = useCallback(async (appId: string) => {
    const loader = moduleLoaders[appId];
    if (!loader) return;
    setItemsByModule(prev => {
      if (prev[appId] !== undefined && prev[appId] !== 'loading') return prev;
      if (prev[appId] === 'loading') return prev;
      return { ...prev, [appId]: 'loading' };
    });
    try {
      const items = await loader();
      setItemsByModule(prev => ({ ...prev, [appId]: items }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur de chargement';
      setItemsByModule(prev => ({ ...prev, [appId]: { error: msg } }));
    }
  }, [moduleLoaders]);

  // Re-fetch already-expanded modules on mount so the sidebar isn't empty
  // on first paint when the user had modules pinned open in a previous
  // session.
  useEffect(() => {
    for (const id of expanded) {
      const state = itemsByModule[id];
      if (state === undefined) {
        void ensureItemsLoaded(id);
      }
    }
    // Run once on mount only — expanded is seeded from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = useCallback((appId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
        void ensureItemsLoaded(appId);
      }
      return next;
    });
  }, [ensureItemsLoaded]);

  const isModuleActive = useCallback((app: AppInfo) => {
    // Active if current path starts with `/<appId>` or matches path.
    if (!currentPath) return false;
    if (currentPath === app.path || currentPath === app.path + '/') return true;
    return currentPath.startsWith(app.path + '/');
  }, [currentPath]);

  const isItemActive = useCallback((item: SidebarItem) => {
    if (!currentPath) return false;
    return currentPath === item.path || currentPath.startsWith(item.path + '/');
  }, [currentPath]);

  return (
    <aside
      className={`app-sidebar ${collapsed ? 'app-sidebar--collapsed' : ''}`}
      aria-label="Navigation principale"
    >
      <div className="app-sidebar__header">
        <button
          type="button"
          className="app-sidebar__toggle"
          onClick={() => setCollapsed(v => !v)}
          aria-label={collapsed ? 'Ouvrir le menu' : 'Fermer le menu'}
          title={collapsed ? 'Ouvrir le menu' : 'Fermer le menu'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
          </svg>
        </button>
      </div>

      <nav className="app-sidebar__nav" aria-label="Modules">
        {visibleApps.map(app => {
          const hasLoader = !!moduleLoaders[app.id];
          const isExpanded = expanded.has(app.id);
          const itemsState = itemsByModule[app.id];
          const isActive = isModuleActive(app);

          return (
            <div key={app.id} className="app-sidebar__module">
              <div
                className={`app-sidebar__module-row ${isActive ? 'app-sidebar__module-row--active' : ''}`}
                style={isActive ? ({ ['--row-accent' as string]: app.color } as React.CSSProperties) : undefined}
              >
                {!collapsed && (hasLoader ? (
                  <button
                    type="button"
                    className={`app-sidebar__chevron ${isExpanded ? 'app-sidebar__chevron--open' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleExpand(app.id); }}
                    aria-label={isExpanded ? `Replier ${app.name}` : `Déplier ${app.name}`}
                    aria-expanded={isExpanded}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ) : (
                  <span className="app-sidebar__chevron-placeholder" aria-hidden="true" />
                ))}
                <button
                  type="button"
                  className="app-sidebar__module-btn"
                  onClick={() => onNavigate(app.path)}
                  title={app.name}
                >
                  <span className="app-sidebar__dot" style={{ background: app.color }} aria-hidden="true" />
                  {!collapsed && <span className="app-sidebar__module-label">{app.name}</span>}
                </button>
              </div>

              {hasLoader && isExpanded && !collapsed && (
                <div className="app-sidebar__items">
                  {itemsState === undefined || itemsState === 'loading' ? (
                    <div className="app-sidebar__items-loading">Chargement…</div>
                  ) : 'error' in (itemsState as { error?: string }) ? (
                    <div className="app-sidebar__items-error">
                      {(itemsState as { error: string }).error}
                    </div>
                  ) : (itemsState as SidebarItem[]).length === 0 ? (
                    <div className="app-sidebar__items-empty">Aucun élément</div>
                  ) : (
                    (itemsState as SidebarItem[]).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={`app-sidebar__item ${isItemActive(item) ? 'app-sidebar__item--active' : ''}`}
                        onClick={() => onNavigate(item.path)}
                        title={item.label}
                      >
                        <span className="app-sidebar__item-label">{item.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {footer && !collapsed && (
        <div className="app-sidebar__footer">{footer}</div>
      )}
    </aside>
  );
}

export default AppSidebar;
