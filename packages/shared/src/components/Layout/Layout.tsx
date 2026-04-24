import type { CSSProperties, ReactNode } from 'react';
import { SharedNav } from '../SharedNav/SharedNav.js';
import { AppSidebar, type ModuleLoader } from '../AppSidebar/AppSidebar.js';
import { useSidebarLoaders } from '../AppSidebar/SidebarLoadersContext.js';
import { APPS } from '../SharedNav/constants.js';
import { useGatewayAuth } from '../../hooks/useGatewayAuth.js';
import styles from './Layout.module.css';

export type LayoutVariant = 'centered' | 'centered-narrow' | 'full-width' | 'sidebar' | 'custom';

export interface LayoutProps {
  children: ReactNode;
  appId?: string;
  variant?: LayoutVariant;
  noAuth?: boolean;
  onNavigate?: (path: string) => void;
  navSlot?: ReactNode;
  /** If provided, only show these app IDs in the menu.
   * If omitted, falls back to the current user's permissions from useGatewayAuth.
   * Pass an empty array to hide all apps. */
  allowedAppIds?: string[];
  /**
   * When defined, renders the <AppSidebar> on the left with these
   * module-specific loaders for lazy-listing elements (plannings,
   * boards, documents…). Set to `false` to explicitly opt out (e.g.
   * landing page, embed, login). Defaults to undefined → no sidebar.
   */
  sidebarLoaders?: Record<string, ModuleLoader> | false;
  /** Current pathname to highlight the active module / item in the sidebar. */
  currentPath?: string;
}

export function Layout({
  children,
  appId,
  variant = 'centered',
  noAuth = false,
  onNavigate,
  navSlot,
  allowedAppIds,
  sidebarLoaders,
  currentPath,
}: LayoutProps) {
  // Auto-fetch user permissions from AuthContext when not explicitly passed.
  // This ensures the burger menu inside a module only shows modules the
  // current user is allowed to access.
  const { user, loading } = useGatewayAuth();
  const effectiveAllowedAppIds = allowedAppIds ?? (noAuth ? undefined : (loading ? [] : user?.permissions));

  const variantClass = {
    centered: styles.centered,
    'centered-narrow': styles.centeredNarrow,
    'full-width': styles.fullWidth,
    sidebar: styles.sidebar,
    custom: styles.custom,
  }[variant];

  const moduleApp = appId ? APPS.find((a) => a.id === appId) : undefined;
  const moduleStyle: CSSProperties | undefined = moduleApp
    ? ({
        ['--accent-primary' as string]: moduleApp.color,
        ['--accent-primary-hover' as string]: moduleApp.gradientEnd,
      } as CSSProperties)
    : undefined;

  // Admin-only extra drawer entries (Logs IA + Évaluations IA + Playground IA).
  // Each one gets a distinct color dot, consistent with the main apps menu.
  const extraDrawerLinks = user?.isAdmin
    ? [
        { label: 'Logs IA',          path: '/ai-logs',         color: '#14b8a6' }, // teal
        { label: 'Routing IA',       path: '/ai-routing',      color: '#0ea5e9' }, // sky
        { label: 'Évaluations IA',   path: '/ai-evals',        color: '#f43f5e' }, // rose
        { label: 'Playground IA',    path: '/ai-playground',   color: '#a855f7' }, // purple
        { label: 'Logs Prompts',     path: '/prompt-logs',     color: '#eab308' }, // amber
        { label: 'Fonctionnalités',  path: '/admin-features',  color: '#f97316' }, // orange
      ]
    : undefined;

  // Loaders can come from an explicit prop OR from <SidebarLoadersProvider>
  // at the app root. Explicit `false` opts out entirely.
  const contextLoaders = useSidebarLoaders();
  const effectiveLoaders = sidebarLoaders === false
    ? null
    : (sidebarLoaders ?? contextLoaders);
  const showSidebar = !!effectiveLoaders;
  const effectivePath = currentPath ?? (typeof window !== 'undefined' ? window.location.pathname : '');

  return (
    <div className={`${styles.app} ${showSidebar ? styles.appWithSidebar : ''}`} style={moduleStyle}>
      <SharedNav
        currentApp={appId}
        onNavigate={onNavigate}
        allowedAppIds={effectiveAllowedAppIds}
        extraDrawerLinks={extraDrawerLinks}
      >
        {navSlot}
      </SharedNav>
      {showSidebar && effectiveLoaders && (
        <AppSidebar
          allowedAppIds={effectiveAllowedAppIds}
          moduleLoaders={effectiveLoaders}
          currentPath={effectivePath}
          onNavigate={(path) => onNavigate ? onNavigate(path) : (window.location.href = path)}
        />
      )}
      <main className={`${styles.main} ${variantClass}`}>{children}</main>
    </div>
  );
}

export default Layout;
