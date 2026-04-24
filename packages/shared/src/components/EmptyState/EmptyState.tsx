import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Main title shown to the user. */
  title: ReactNode;
  /** Optional secondary explanation line. */
  hint?: ReactNode;
  /** Optional icon rendered above the title. */
  icon?: ReactNode;
  /** Optional action area (button, link). */
  action?: ReactNode;
  /** Extra className on root. */
  className?: string;
}

/**
 * Centered placeholder used when a collection is empty (no items, no
 * results, nothing to display yet). Replaces the recurring
 * `<div className="empty">Aucun ...</div>` pattern across modules.
 */
export function EmptyState({ title, hint, icon, action, className }: EmptyStateProps) {
  return (
    <div className={`shared-empty-state ${className ?? ''}`.trim()} role="status">
      {icon && <div className="shared-empty-state__icon" aria-hidden="true">{icon}</div>}
      <div className="shared-empty-state__title">{title}</div>
      {hint && <div className="shared-empty-state__hint">{hint}</div>}
      {action && <div className="shared-empty-state__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
