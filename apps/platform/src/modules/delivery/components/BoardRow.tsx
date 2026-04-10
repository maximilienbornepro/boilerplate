import { useMemo, useState } from 'react';
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
  onNestTask?: (childId: string, containerId: string) => void;
  onUnnestTask?: (childId: string) => void;
  jiraBaseUrl?: string | null;
  /** Called when a container is dropped onto this row's label area.
   *  Receives the dragged task id. Used for cross-row container moves. */
  onContainerDrop?: (taskId: string) => void;
  /** Called when a container is dragged and released over a different
   *  row's label. Detected via elementsFromPoint on mouseup inside TaskBlock. */
  onProjectDrop?: (taskId: string, project: string) => void;
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
  onNestTask,
  onUnnestTask,
  jiraBaseUrl,
  onContainerDrop,
  onProjectDrop,
}: BoardRowProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  // Account for rowSpan when computing the container height
  const maxRow = Math.max(0, ...tasks.map((t) => (t.row ?? 0) + (t.rowSpan ?? 1) - 1));
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

  const handleLabelDragOver = (e: React.DragEvent) => {
    // Only accept drops with our custom container drag data.
    if (!e.dataTransfer.types.includes('application/x-container-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleLabelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('application/x-container-id');
    if (taskId && onContainerDrop) {
      onContainerDrop(taskId);
    }
  };

  return (
    <div className={styles.boardRow}>
      <div
        className={`${styles.rowLabel} ${isDragOver ? styles.rowLabelDragOver : ''}`}
        data-project={label}
        onDragOver={handleLabelDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleLabelDrop}
      >
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
            onNestTask={readOnly ? undefined : onNestTask}
            onUnnest={readOnly ? undefined : onUnnestTask}
            jiraBaseUrl={jiraBaseUrl}
            onProjectDrop={onProjectDrop}
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
