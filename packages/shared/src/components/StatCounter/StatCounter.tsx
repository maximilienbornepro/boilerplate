import './StatCounter.css';

export interface StatItem {
  value: string;
  label: string;
}

export interface StatCounterProps {
  items: StatItem[];
  className?: string;
}

export function StatCounter({ items, className }: StatCounterProps) {
  return (
    <div className={`shared-stat-counter ${className || ''}`}>
      {items.map((item) => (
        <div key={item.label} className="shared-stat-item">
          <span className="shared-stat-value">{item.value}</span>
          <span className="shared-stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
