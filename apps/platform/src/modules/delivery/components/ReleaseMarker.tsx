import type { Release, Sprint } from '../types';
import styles from './ReleaseMarker.module.css';

interface ReleaseMarkerProps {
  release: Release;
  sprints: Sprint[];
  totalCols: number;
}

// Calculate the column position (0-6) based on release date within sprint range
function calculateColumnPosition(releaseDate: string, sprints: Sprint[], totalCols: number): number | null {
  if (!releaseDate || releaseDate === 'TBD' || sprints.length === 0) {
    return null;
  }

  const release = new Date(releaseDate);
  const piStart = new Date(sprints[0].startDate);
  const piEnd = new Date(sprints[sprints.length - 1].endDate);

  // Check if release is within increment range
  if (release < piStart || release > piEnd) {
    return null;
  }

  // Calculate total days in increment
  const totalDays = (piEnd.getTime() - piStart.getTime()) / (1000 * 60 * 60 * 24);

  // Calculate days from start to release
  const daysFromStart = (release.getTime() - piStart.getTime()) / (1000 * 60 * 60 * 24);

  // Convert to column position (0 to totalCols)
  const position = (daysFromStart / totalDays) * totalCols;

  return Math.max(0, Math.min(totalCols, position));
}

// Format date for display
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === 'TBD') return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export function ReleaseMarker({ release, sprints, totalCols }: ReleaseMarkerProps) {
  const position = calculateColumnPosition(release.date, sprints, totalCols);

  if (position === null) {
    return null;
  }

  const leftPercent = (position / totalCols) * 100;

  return (
    <div
      className={styles.releaseMarker}
      style={{ left: `${leftPercent}%` }}
      title={`Release ${release.version} - ${formatDate(release.date)}`}
    >
      <div className={styles.line} />
      <div className={styles.badge}>
        <span className={styles.version}>{release.version}</span>
        <span className={styles.date}>{formatDate(release.date)}</span>
      </div>
    </div>
  );
}
