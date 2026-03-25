import { useMemo } from 'react';
import type { Dependency, Task, ViewMode, TaskPosition } from '../../types';
import { calculateTaskPosition, parseDate, getColumnWidth } from '../../utils/dateUtils';
import { calculateDependencyPath } from '../../hooks/useDependencyDraw';
import styles from './DependencyLines.module.css';

interface DependencyLinesProps {
  dependencies: Dependency[];
  tasks: Task[];
  taskIndexMap: Map<string, number>;
  chartStartDate: Date;
  viewMode: ViewMode;
  onDelete?: (dependencyId: string) => void;
  isDrawing?: boolean;
  fromTaskId?: string | null;
  mousePosition?: { x: number; y: number } | null;
}

const ROW_HEIGHT = 64;
const BAR_HEIGHT = 48;

export function DependencyLines({
  dependencies,
  tasks,
  taskIndexMap,
  chartStartDate,
  viewMode,
  onDelete,
  isDrawing,
  fromTaskId,
  mousePosition,
}: DependencyLinesProps) {
  const columnWidth = getColumnWidth(viewMode);

  const taskPositions = useMemo(() => {
    const positions = new Map<string, TaskPosition>();
    for (const task of tasks) {
      const index = taskIndexMap.get(task.id);
      if (index === undefined) continue;
      const taskStart = parseDate(task.startDate);
      const taskEnd = parseDate(task.endDate);
      const { left, width } = calculateTaskPosition(taskStart, taskEnd, chartStartDate, columnWidth, viewMode);
      positions.set(task.id, {
        taskId: task.id,
        x: 250 + left,
        y: index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
        width,
        height: BAR_HEIGHT,
      });
    }
    return positions;
  }, [tasks, taskIndexMap, chartStartDate, columnWidth, viewMode]);

  const lines = useMemo(() => {
    return dependencies
      .map((dep) => {
        const from = taskPositions.get(dep.fromTaskId);
        const to = taskPositions.get(dep.toTaskId);
        if (!from || !to) return null;
        const path = calculateDependencyPath(from, to, dep.type);
        return { id: dep.id, path };
      })
      .filter(Boolean) as { id: string; path: string }[];
  }, [dependencies, taskPositions]);

  const handleDeleteClick = (e: React.MouseEvent, depId: string) => {
    e.stopPropagation();
    if (onDelete && window.confirm('Supprimer cette dependance ?')) {
      onDelete(depId);
    }
  };

  const drawingLine = useMemo(() => {
    if (!isDrawing || !fromTaskId || !mousePosition) return null;
    const fromPosition = taskPositions.get(fromTaskId);
    if (!fromPosition) return null;
    const startX = fromPosition.x + fromPosition.width;
    const startY = fromPosition.y + fromPosition.height / 2;
    const endX = mousePosition.x;
    const endY = mousePosition.y;
    const midX = startX + (endX - startX) / 2;
    return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
  }, [isDrawing, fromTaskId, mousePosition, taskPositions]);

  return (
    <svg className={styles.container}>
      <defs>
        <marker id="dep-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className={styles.arrowFill} />
        </marker>
      </defs>

      {lines.map((line) => (
        <g key={line.id} className={styles.dependencyGroup}>
          <path d={line.path} className={styles.dependencyLine} markerEnd="url(#dep-arrowhead)" />
          <path d={line.path} className={styles.dependencyHitArea} onClick={(e) => handleDeleteClick(e, line.id)} />
        </g>
      ))}

      {drawingLine && (
        <path d={drawingLine} className={styles.drawingLine} markerEnd="url(#dep-arrowhead)" />
      )}
    </svg>
  );
}
