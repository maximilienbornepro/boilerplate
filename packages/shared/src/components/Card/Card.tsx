import type { ReactNode, MouseEvent } from 'react';
import './Card.css';

export interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  selected?: boolean;
  variant?: 'default' | 'compact' | 'interactive';
}

export function Card({ children, className, onClick, selected, variant = 'default' }: CardProps) {
  return (
    <div
      className={`shared-card shared-card--${variant} ${selected ? 'shared-card--selected' : ''} ${onClick ? 'shared-card--clickable' : ''} ${className || ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
