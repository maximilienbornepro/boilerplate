import type { ReactNode } from 'react';
import './ActionCard.css';

export interface ActionCardProps {
  selected?: boolean;
  onToggle?: () => void;
  impact?: 'critical' | 'important' | 'bonus';
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function ActionCard({ selected, onToggle, impact = 'important', children, meta, className }: ActionCardProps) {
  return (
    <div className={`shared-action-card ${selected ? 'shared-action-card--selected' : ''} shared-action-card--${impact} ${className || ''}`}>
      {onToggle && (
        <label className="shared-action-card-check">
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </label>
      )}
      <div className="shared-action-card-content">
        {children}
      </div>
      {meta && <div className="shared-action-card-meta">{meta}</div>}
    </div>
  );
}
