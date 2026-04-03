import './SectionTitle.css';

export interface SectionTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionTitle({ children, className }: SectionTitleProps) {
  return (
    <h3 className={`shared-section-title ${className || ''}`}>
      {children}
    </h3>
  );
}
