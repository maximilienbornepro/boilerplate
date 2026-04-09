import type { ReactNode } from 'react';
import styles from './ModuleHeader.module.css';

export interface ModuleHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle or breadcrumb text */
  subtitle?: string;
  /** Back button handler - if omitted, no back button is shown */
  onBack?: () => void;
  /** Back button label (default: "Retour") */
  backLabel?: string;
  /** Action buttons (right side of header) */
  children?: ReactNode;
  /** Additional class name */
  className?: string;
}

export function ModuleHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Retour',
  children,
  className = '',
}: ModuleHeaderProps) {
  return (
    <header className={`${styles.header} ${className}`}>
      <div className={styles.left}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack} type="button">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span className={styles.backLabel}>{backLabel}</span>
          </button>
        )}
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}

export default ModuleHeader;
