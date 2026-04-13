import { useState, type ReactNode } from 'react';
import './ExpandableSection.css';

interface ExpandableSectionProps {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  badge?: string | number;
}

export function ExpandableSection({
  title,
  children,
  defaultExpanded = false,
  badge,
}: ExpandableSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`expandable-section ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="expandable-section-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="expandable-section-icon" style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <span className="expandable-section-title">{title}</span>
        {badge !== undefined && (
          <span className="expandable-section-badge">{badge}</span>
        )}
      </button>
      {expanded && (
        <div className="expandable-section-content">
          {children}
        </div>
      )}
    </div>
  );
}
