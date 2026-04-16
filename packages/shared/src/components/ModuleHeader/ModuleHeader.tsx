import type { ReactNode } from 'react';
import styles from './ModuleHeader.module.css';

export interface ModuleHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle or breadcrumb text */
  subtitle?: string;
  /** Optional content rendered next to the title (e.g. a switcher) */
  titleSlot?: ReactNode;
  /** Back button handler - if omitted, no back button is shown */
  onBack?: () => void;
  /** Back button label (default: "Retour à la liste") */
  backLabel?: string;
  /** Action buttons (right side of header) */
  children?: ReactNode;
  /** Additional class name */
  className?: string;
}

export function ModuleHeader({
  title,
  subtitle,
  titleSlot,
  onBack,
  backLabel = 'Retour à la liste',
  children,
  className = '',
}: ModuleHeaderProps) {
  return (
    <header className={`${styles.header} ${className}`}>
      <div className={styles.left}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack} type="button">
            <svg
              width="22"
              height="12"
              viewBox="0 0 22 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="21" y1="6" x2="1" y2="6" />
              <polyline points="6 1 1 6 6 11" />
            </svg>
            <span className={styles.backLabel}>{backLabel}</span>
          </button>
        )}
        <div className={styles.titleGroup}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {titleSlot}
          </div>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}

export default ModuleHeader;
