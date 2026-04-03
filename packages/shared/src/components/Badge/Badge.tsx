import './Badge.css';

export type BadgeType = 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps {
  children: React.ReactNode;
  type?: BadgeType;
  className?: string;
}

export function Badge({ children, type = 'accent', className }: BadgeProps) {
  return (
    <span className={`shared-badge shared-badge--${type} ${className || ''}`}>
      {children}
    </span>
  );
}
