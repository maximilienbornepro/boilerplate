import type { CSSProperties, ReactNode } from 'react';
import { SharedNav } from '../SharedNav/SharedNav.js';
import { APPS } from '../SharedNav/constants.js';
import { useGatewayUser } from '../../hooks/useGatewayAuth.js';
import styles from './Layout.module.css';

export type LayoutVariant = 'centered' | 'centered-narrow' | 'full-width' | 'sidebar' | 'custom';

export interface LayoutProps {
  children: ReactNode;
  appId?: string;
  variant?: LayoutVariant;
  noAuth?: boolean;
  onNavigate?: (path: string) => void;
  navSlot?: ReactNode;
  /** If provided, only show these app IDs in the menu */
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

  // Auto-fetch user permissions from AuthContext if not explicitly passed.
  // This ensures the burger menu inside a module only shows modules the
  // current user is allowed to access.
  const { user } = useGatewayUser();
  const effectiveAllowedAppIds = allowedAppIds ?? (noAuth ? undefined : user?.permissions);

  return (
    <div className={styles.app} style={moduleStyle}>
      <SharedNav
        currentApp={appId}
        onNavigate={onNavigate}
        allowedAppIds={effectiveAllowedAppIds}
      >
        {navSlot}
      </SharedNav>
      <main className={`${styles.main} ${variantClass}`}>{children}</main>
    </div>
  );
}

export default Layout;
