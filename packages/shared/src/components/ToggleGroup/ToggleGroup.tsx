import './ToggleGroup.css';

export interface ToggleOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ToggleGroupProps<T extends string = string> {
  options: ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function ToggleGroup<T extends string = string>({ options, value, onChange, className }: ToggleGroupProps<T>) {
  return (
    <div className={`shared-toggle-group ${className || ''}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          className={`shared-toggle-btn ${value === opt.value ? 'shared-toggle-btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
