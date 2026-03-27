import type { Sprint } from '../types';
import styles from './SprintColumn.module.css';

interface SprintColumnProps {
  sprint: Sprint;
}

// Extract sprint number from name (e.g., "S1 Increment 1 2026" -> "Sprint 1")
function extractSprintLabel(name: string): string {
  const match = name.match(/S(\d+)/i);
  return match ? `Sprint ${match[1]}` : name;
}

export function SprintColumn({ sprint }: SprintColumnProps) {
  const formatDate = (dateStr: string) => {
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}`;
  };

  const sprintLabel = extractSprintLabel(sprint.name);

  return (
    <div className={styles.sprintColumn}>
      <div className={styles.dates}>
        <span>{formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}</span>
      </div>
      <div className={styles.name}>{sprintLabel}</div>
    </div>
  );
}
