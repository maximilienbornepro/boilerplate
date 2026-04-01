import type { ReactNode } from 'react';
import './FormField.css';

export interface FormFieldProps {
  label?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, error, required, children, className }: FormFieldProps) {
  return (
    <div className={`shared-form-field ${error ? 'shared-form-field--error' : ''} ${className || ''}`}>
      {label && (
        <label className="shared-form-field-label">
          {label}
          {required && <span className="shared-form-field-required">*</span>}
        </label>
      )}
      <div className="shared-form-field-content">
        {children}
      </div>
      {error && <span className="shared-form-field-error">{error}</span>}
    </div>
  );
}
