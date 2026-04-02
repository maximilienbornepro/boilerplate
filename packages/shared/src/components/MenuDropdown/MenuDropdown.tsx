import { useState, useRef, useEffect, type ReactNode } from 'react';
import './MenuDropdown.css';

export interface MenuDropdownItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export interface MenuDropdownProps {
  items: MenuDropdownItem[];
  trigger?: ReactNode;
  className?: string;
}

export function MenuDropdown({ items, trigger, className }: MenuDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={`shared-menu-dropdown ${className || ''}`} ref={ref}>
      <button
        className="shared-menu-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        type="button"
      >
        {trigger || '\u22EF'}
      </button>
      {open && (
        <div className="shared-menu-list">
          {items.map((item, idx) => (
            <button
              key={idx}
              className={`shared-menu-item ${item.danger ? 'shared-menu-item--danger' : ''}`}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              type="button"
            >
              {item.icon && <span className="shared-menu-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
