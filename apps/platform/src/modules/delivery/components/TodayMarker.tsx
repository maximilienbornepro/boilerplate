import type { Sprint } from '../types';
import styles from './TodayMarker.module.css';

interface TodayMarkerProps {
  sprints: Sprint[];
  totalCols: number;
}

// Calculate the column position (0-6) based on current date within sprint range
function calculateColumnPosition(sprints: Sprint[], totalCols: number): number | null {
  if (sprints.length === 0) {
    return null;
  }

  const today = new Date();
  const piStart = new Date(sprints[0].startDate);
  const piEnd = new Date(sprints[sprints.length - 1].endDate);

  // Check if today is within increment range
  if (today < piStart || today > piEnd) {
    return null;
  }

  // Calculate total days in increment
  const totalDays = (piEnd.getTime() - piStart.getTime()) / (1000 * 60 * 60 * 24);

  // Calculate days from start to today
  const daysFromStart = (today.getTime() - piStart.getTime()) / (1000 * 60 * 60 * 24);

  // Convert to column position (0 to totalCols)
  const position = (daysFromStart / totalDays) * totalCols;

  return Math.max(0, Math.min(totalCols, position));
}

export function TodayMarker({ sprints, totalCols }: TodayMarkerProps) {
  const position = calculateColumnPosition(sprints, totalCols);

  if (position === null) {
    return null;
  }

  const leftPercent = (position / totalCols) * 100;

  return (
    <div
      className={styles.todayMarker}
      style={{ left: `${leftPercent}%` }}
      title="Aujourd'hui"
    >
      <div className={styles.line} />
      <div className={styles.badge}>Aujourd'hui</div>
    </div>
  );
}
