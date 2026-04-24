import { useEffect, useRef, useState } from 'react';
import './ViewSelector.css';

export interface ViewModeOption<T extends string> {
  value: T;
  label: string;
}

export interface ViewSelectorProps<T extends string> {
  /** Current selected mode. */
  viewMode: T;
  /** Called when user picks a new mode. */
  onViewModeChange: (mode: T) => void;
  /** Available modes in the dropdown. */
  modes: ReadonlyArray<ViewModeOption<T>>;
  /** Current year to display. Pass only if year navigation is needed. */
  year?: number;
  /** Called with -1 (prev) or +1 (next) when user clicks the year arrows. */
  onYearChange?: (direction: -1 | 1) => void;
  /** Called when user clicks "Aujourd'hui". Shown only if provided. */
  onToday?: () => void;
  /** Disables the year arrows (keeps them visible). */
  yearNavDisabled?: boolean;
  /** Extra className to apply on the root. */
  className?: string;
}

/**
 * Dropdown for time-granularity views (Mois / Trimestre / Année) + optional
 * year navigation. Promoted from conges/ViewControls and roadmap/ViewSelector.
 */
export function ViewSelector<T extends string>({
  viewMode,
  onViewModeChange,
  modes,
  year,
  onYearChange,
  onToday,
  yearNavDisabled = false,
  className,
}: ViewSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentLabel = modes.find((m) => m.value === viewMode)?.label ?? String(viewMode);
  const hasYearNav = typeof year === 'number' && !!onYearChange;

  return (
    <div className={`shared-view-selector ${className ?? ''}`.trim()}>
      <div className="shared-view-selector__filter" ref={dropdownRef}>
        <button
          type="button"
          className="shared-view-selector__btn"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="shared-view-selector__label">{currentLabel}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <ul className="shared-view-selector__menu" role="listbox">
            {modes.map((m) => (
              <li key={m.value}>
                <button
                  type="button"
                  className={`shared-view-selector__menu-item${
                    viewMode === m.value ? ' shared-view-selector__menu-item--active' : ''
                  }`}
                  onClick={() => {
                    onViewModeChange(m.value);
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={viewMode === m.value}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasYearNav && (
        <div className="shared-view-selector__year-nav">
          {onToday && (
            <>
              <button type="button" className="shared-view-selector__today-btn" onClick={onToday}>
                Aujourd&apos;hui
              </button>
              <span className="shared-view-selector__divider" aria-hidden="true" />
            </>
          )}
          <button
            type="button"
            className="shared-view-selector__nav-btn"
            onClick={() => !yearNavDisabled && onYearChange!(-1)}
            aria-label="Année précédente"
            disabled={yearNavDisabled}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="shared-view-selector__year-label">{year}</span>
          <button
            type="button"
            className="shared-view-selector__nav-btn"
            onClick={() => !yearNavDisabled && onYearChange!(1)}
            aria-label="Année suivante"
            disabled={yearNavDisabled}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default ViewSelector;
