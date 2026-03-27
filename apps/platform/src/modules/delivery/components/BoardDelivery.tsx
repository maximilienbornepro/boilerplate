import type { Sprint, Task, Release } from '../types';
import { BoardRow } from './BoardRow';
import { SprintColumn } from './SprintColumn';
import { ReleaseMarker } from './ReleaseMarker';
import { TodayMarker } from './TodayMarker';
import styles from './BoardDelivery.module.css';

interface BoardDeliveryProps {
  sprints: Sprint[];
  tasks: Task[];
  releases: Release[];
  boardLabel: string;
  readOnly?: boolean;
  showReleaseMarkers?: boolean;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskResize?: (taskId: string, newStartCol: number, newEndCol: number) => void;
  onTaskMove?: (taskId: string, newStartCol: number, newRow: number) => void;
}

const ROW_HEIGHT = 95;
const TOTAL_COLS = 6;

export function BoardDelivery({
  sprints,
  tasks,
  releases,
  boardLabel,
  readOnly = false,
  showReleaseMarkers = true,
  onTaskUpdate,
  onTaskDelete,
  onTaskResize,
  onTaskMove,
}: BoardDeliveryProps) {
  return (
    <div className={styles.board}>
      <div className={styles.sprintHeader}>
        <div className={styles.platformLabel}></div>
        {sprints.map((sprint) => (
          <SprintColumn key={sprint.id} sprint={sprint} />
        ))}
      </div>

      <div className={styles.boardContent}>
        {/* Release Markers + Today Marker */}
        {showReleaseMarkers && (
          <div className={styles.markerLayer}>
            <TodayMarker sprints={sprints} totalCols={TOTAL_COLS} />
            {releases.map((release) => (
              <ReleaseMarker
                key={release.id}
                release={release}
                sprints={sprints}
                totalCols={TOTAL_COLS}
              />
            ))}
          </div>
        )}

        <BoardRow
          label={boardLabel}
          tasks={tasks}
          totalCols={TOTAL_COLS}
          rowHeight={ROW_HEIGHT}
          readOnly={readOnly}
          sprints={sprints}
          onTaskUpdate={onTaskUpdate}
          onTaskDelete={onTaskDelete}
          onTaskResize={onTaskResize}
          onTaskMove={onTaskMove}
        />
      </div>
    </div>
  );
}
