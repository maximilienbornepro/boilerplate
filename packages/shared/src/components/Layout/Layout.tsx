import type { CSSProperties, ReactNode } from 'react';
import { SharedNav } from '../SharedNav/SharedNav.js';
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
}

export function Layout({
  children,
  appId,
  variant = 'centered',
  noAuth = false,
  onNavigate,
  navSlot,
  allowedAppIds,
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

  // Admin-only extra drawer entries (Logs IA for now).
  const extraDrawerLinks = user?.isAdmin
    ? [{ label: 'Logs IA', path: '/ai-logs' }]
    : undefined;

  return (
    <div className={styles.app} style={moduleStyle}>
      <SharedNav
        currentApp={appId}
        onNavigate={onNavigate}
        allowedAppIds={effectiveAllowedAppIds}
        extraDrawerLinks={extraDrawerLinks}
      >
        {navSlot}
      </SharedNav>
      <main className={`${styles.main} ${variantClass}`}>{children}</main>
    </div>
  );
}

export default Layout;
