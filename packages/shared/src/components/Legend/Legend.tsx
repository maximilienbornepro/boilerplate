import type { ReactNode } from 'react';
import './Legend.css';

export interface LegendItem {
  /** Unique key for the list item. */
  id: string;
  /** Swatch color (any CSS color or CSS variable). */
  color: string;
  /** Text displayed next to the swatch. */
  label: ReactNode;
}

export interface LegendProps {
  /** Items to render. Each gets a color swatch + label. */
  items: ReadonlyArray<LegendItem>;
  /** Accessible label for the legend list. */
  ariaLabel?: string;
  /** Layout direction. Defaults to column. */
  direction?: 'column' | 'row';
  /** Extra className on root. */
  className?: string;
}

/**
 * Color-swatch + label list. Promoted from conges/Legend. Generic enough to
 * be reused in delivery (status legends), roadmap (dependency types), etc.
 */
export function Legend({ items, ariaLabel, direction = 'column', className }: LegendProps) {
  return (
    <div
      className={`shared-legend shared-legend--${direction} ${className ?? ''}`.trim()}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <div key={item.id} className="shared-legend__item">
          <span className="shared-legend__swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span className="shared-legend__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default Legend;
