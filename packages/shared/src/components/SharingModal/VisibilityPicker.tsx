import styles from './SharingModal.module.css';

export type Visibility = 'private' | 'public';

export interface VisibilityPickerProps {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}

export function VisibilityPicker({ value, onChange, disabled }: VisibilityPickerProps) {
  return (
    <div className={styles.visibilityOptions}>
      <button
        className={`${styles.visibilityOption} ${value === 'private' ? styles.selected : ''}`}
        onClick={() => onChange('private')}
        disabled={disabled}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Privé</span>
      </button>
      <button
        className={`${styles.visibilityOption} ${value === 'public' ? styles.selected : ''}`}
        onClick={() => onChange('public')}
        disabled={disabled}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>Public</span>
      </button>
    </div>
  );
}
