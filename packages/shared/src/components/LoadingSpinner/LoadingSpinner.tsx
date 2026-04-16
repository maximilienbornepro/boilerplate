import styles from './LoadingSpinner.module.css';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  fullPage?: boolean;
}

export function LoadingSpinner({ message, size = 'md', fullPage = false }: LoadingSpinnerProps) {
  return (
    <div className={`${styles.container} ${fullPage ? styles.fullPage : ''}`}>
      <div className={`${styles.logo} ${styles[size]}`}>
        <svg viewBox="0 0 40 30" fill="none" className={styles.logoSvg}>
          {/* > chevron */}
          <polyline
            points="4,4 18,15 4,26"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.chevron}
          />
          {/* _ underscore */}
          <line
            x1="22" y1="26" x2="36" y2="26"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className={styles.underscore}
          />
        </svg>
      </div>
      {message && <p className={styles.message}>{message}</p>}
    </div>
  );
}

export default LoadingSpinner;
