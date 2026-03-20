import type { ReactNode } from 'react';
import { SharedNav } from '../SharedNav/SharedNav.js';
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

  return (
    <div className={styles.app}>
      <SharedNav
        currentApp={appId}
        onNavigate={onNavigate}
        allowedAppIds={allowedAppIds}
      >
        {navSlot}
      </SharedNav>
      <main className={`${styles.main} ${variantClass}`}>{children}</main>
    </div>
  );
}

export default Layout;
