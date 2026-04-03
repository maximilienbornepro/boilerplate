import type { ReactNode, MouseEvent } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

export function Button({
  children,
  variant = 'primary',
  disabled = false,
  onClick,
  className,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      className={`shared-btn shared-btn--${variant} ${disabled ? 'shared-btn--disabled' : ''} ${className || ''}`}
      onClick={onClick}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  );
}
