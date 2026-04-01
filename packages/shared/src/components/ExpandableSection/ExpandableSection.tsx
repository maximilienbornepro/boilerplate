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
        <span className="expandable-section-icon">{expanded ? '▼' : '▶'}</span>
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
