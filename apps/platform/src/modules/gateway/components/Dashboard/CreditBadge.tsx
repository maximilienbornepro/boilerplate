import { useEffect, useState } from 'react';
import styles from './Dashboard.module.css';

interface CreditInfo {
  enabled: boolean;
  balance: number;
  monthlyAllocation: number;
}

interface Props {
  onNavigate?: (path: string) => void;
}

export function CreditBadge({ onNavigate }: Props) {
  const [credits, setCredits] = useState<CreditInfo | null>(null);

  useEffect(() => {
    fetch('/api/connectors/credits', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setCredits)
      .catch(() => {});
  }, []);

  if (!credits || !credits.enabled) return null;

  const pct = credits.monthlyAllocation > 0
    ? Math.max(0, Math.min(100, (credits.balance / credits.monthlyAllocation) * 100))
    : 0;
  const color = pct > 30 ? 'var(--accent-primary)' : pct > 10 ? 'var(--color-warning, #f59e0b)' : 'var(--color-error, #dc2626)';

  const handleClick = () => {
    if (onNavigate) onNavigate('/reglages');
    else window.location.href = '/reglages';
  };

  return (
    <button className={styles.creditBadge} onClick={handleClick} title="Gerer les credits">
      <div className={styles.creditTop}>
        <span className={styles.creditLabel}>Credits</span>
        <span className={styles.creditValue}>
          <strong>{credits.balance}</strong> / {credits.monthlyAllocation}
        </span>
      </div>
      <div className={styles.creditBar}>
        <div className={styles.creditBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
    </button>
  );
}
