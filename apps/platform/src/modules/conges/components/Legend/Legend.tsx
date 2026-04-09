import { LEAVE_REASONS } from '../../types';
import styles from './Legend.module.css';

export function Legend() {
  return (
    <div className={styles.legend} aria-label="Légende des motifs de congé">
      {LEAVE_REASONS.map((reason) => (
        <div key={reason.id} className={styles.item}>
          <span
            className={styles.swatch}
            style={{ backgroundColor: reason.color }}
            aria-hidden="true"
          />
          <span className={styles.label}>{reason.label}</span>
        </div>
      ))}
    </div>
  );
}

export default Legend;
