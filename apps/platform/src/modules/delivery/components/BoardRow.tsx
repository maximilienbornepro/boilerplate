import { useMemo } from 'react';
import type { Task, Sprint } from '../types';
import { TaskBlock } from './TaskBlock';
import styles from './BoardRow.module.css';

interface BoardRowProps {
  label: string;
  tasks: Task[];
  totalCols: number;
  rowHeight: number;
  readOnly?: boolean;
  sprints?: Sprint[];
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskResize?: (taskId: string, newStartCol: number, newEndCol: number) => void;
  onTaskMove?: (taskId: string, newStartCol: number, newRow: number) => void;
}

export function BoardRow({
  label,
  tasks,
  totalCols,
  rowHeight,
  readOnly = false,
  sprints = [],
  onTaskUpdate,
  onTaskDelete,
  onTaskResize,
  onTaskMove,
}: BoardRowProps) {
  const maxRow = Math.max(0, ...tasks.map((t) => t.row ?? 0));
  const minHeight = (maxRow + 1) * (rowHeight + 10) + 20;

  // Determine which sprint is active (current date is within sprint dates)
  const _activeSprintIndex = useMemo(() => {
    if (sprints.length === 0) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sprints.length; i++) {
      const start = new Date(sprints[i].startDate);
      const end = new Date(sprints[i].endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      if (today >= start && today <= end) {
        return i;
      }
    }
    return 0;
  }, [sprints]);

  // Keep activeSprintIndex reference for future use
  void _activeSprintIndex;

  return (
    <div className={styles.boardRow}>
      <div className={styles.rowLabel}>
        <span>{label}</span>
      </div>
      <div className={styles.timeline} style={{ minHeight }}>
        {tasks.map((task) => (
          <TaskBlock
            key={task.id}
            task={task}
            totalCols={totalCols}
            rowHeight={rowHeight}
            readOnly={readOnly}
            onUpdate={readOnly ? undefined : onTaskUpdate}
            onDelete={readOnly ? undefined : onTaskDelete}
            onResize={readOnly ? undefined : onTaskResize}
            onMove={readOnly ? undefined : onTaskMove}
          />
        ))}

        {/* Sprint dividers */}
        {Array.from({ length: totalCols - 1 }, (_, i) => (
          <div
            key={i}
            className={styles.sprintDivider}
            style={{ left: `${((i + 1) / totalCols) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
