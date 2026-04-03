import type { ReactNode } from 'react';
import './Tabs.css';

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={`shared-tabs ${className || ''}`}>
      {tabs.map(tab => (
        <button
          key={tab.value}
          className={`shared-tab ${value === tab.value ? 'shared-tab--active' : ''}`}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
