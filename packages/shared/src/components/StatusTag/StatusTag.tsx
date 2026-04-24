import type { ReactNode } from 'react';
import './StatusTag.css';

export interface StatusTagProps {
  /** Visible text (e.g. "À faire", "En cours"). Never use emojis here. */
  label: ReactNode;
  /** Accent color for the tag (hex, rgb, or CSS var). */
  color: string;
  /**
   * Visual style. Default: "dot" — canonical SuiviTess display
   * (colored dot + label). Other variants available for different contexts.
   */
  variant?: 'dot' | 'tint' | 'solid' | 'outline';
  /** Extra className on root. */
  className?: string;
}

/**
 * Colored tag used to display the status of a subject/task across modules.
 * Always renders the label without emoji prefix. The default "dot" variant
 * matches the SuiviTess preview rendering (dot + text) which is the
 * canonical subject-status display — use it unless another visual style is
 * explicitly required.
 */
export function StatusTag({ label, color, variant = 'dot', className }: StatusTagProps) {
  return (
    <span
      className={`shared-status-tag shared-status-tag--${variant} ${className ?? ''}`.trim()}
      style={{ ['--status-color' as string]: color }}
    >
      {variant === 'dot' && <span className="shared-status-tag__dot" aria-hidden="true" />}
      <span className="shared-status-tag__label">{label}</span>
    </span>
  );
}

export default StatusTag;
