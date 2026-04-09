import { useMemo, useRef } from 'react';
import type { Leave } from '../../types';
import styles from './LeaveBar.module.css';

interface LeaveBarProps {
  leave: Leave;
  color: string;
  chartStartDate: string;
  columnWidth: number;
  isDraggable: boolean;
  previewStart?: string;
  previewEnd?: string;
  onClick: (leave: Leave) => void;
  onDragStart: (e: React.DragEvent, leave: Leave, grabDayOffset: number) => void;
  onResizeStart: (e: React.MouseEvent, leave: Leave, side: 'left' | 'right') => void;
}

function getDayOffset(date: string, chartStart: string): number {
  const d = new Date(date);
  const s = new Date(chartStart);
  return Math.floor((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

const PERIOD_LABELS: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  full: '',
};

export function LeaveBar({
  leave,
  color,
  chartStartDate,
  columnWidth,
  isDraggable,
  previewStart,
  previewEnd,
  onClick,
  onDragStart,
  onResizeStart,
}: LeaveBarProps) {
  const effectiveStart = previewStart ?? leave.startDate;
  const effectiveEnd = previewEnd ?? leave.endDate;

  const position = useMemo(() => {
    const startOffset = getDayOffset(effectiveStart, chartStartDate);
    const endOffset = getDayOffset(effectiveEnd, chartStartDate);
    const daySpan = endOffset - startOffset + 1;

    let left = startOffset * columnWidth;
    let width = daySpan * columnWidth;

    if (leave.startPeriod === 'afternoon' && !previewStart) {
      left += columnWidth / 2;
      width -= columnWidth / 2;
    }
    if (leave.endPeriod === 'morning' && !previewEnd) {
      width -= columnWidth / 2;
    }

    return { left, width: Math.max(width, 4) };
  }, [effectiveStart, effectiveEnd, chartStartDate, columnWidth, leave.startPeriod, leave.endPeriod, previewStart, previewEnd]);

  const title = [
    leave.reason,
    leave.startPeriod !== 'full' ? `Début: ${PERIOD_LABELS[leave.startPeriod]}` : null,
    leave.endPeriod !== 'full' ? `Fin: ${PERIOD_LABELS[leave.endPeriod]}` : null,
  ].filter(Boolean).join(' | ') || 'Congé';

  const showHandles = isDraggable;

  // Prevent click from firing after a resize interaction
  const didResize = useRef(false);

  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggable) { e.preventDefault(); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const grabX = e.clientX - rect.left;
    const grabDayOffset = Math.floor(grabX / columnWidth);
    onDragStart(e, leave, grabDayOffset);
  };

  return (
    <div
      className={`${styles.bar} ${isDraggable ? styles.draggable : ''} ${previewStart || previewEnd ? styles.resizing : ''}`}
      style={{ left: position.left, width: position.width, backgroundColor: color }}
      title={isDraggable ? `${title} — glisser pour déplacer` : title}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onClick={(e) => {
        e.stopPropagation();
        if (didResize.current) { didResize.current = false; return; }
        onClick(leave);
      }}
    >
      {/* Left resize handle */}
      {showHandles && (
        <div
          className={styles.resizeHandle}
          style={{ left: 0 }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); didResize.current = true; onResizeStart(e, leave, 'left'); }}
          title="Modifier la date de début"
        />
      )}

      {/* Right resize handle */}
      {showHandles && (
        <div
          className={styles.resizeHandle}
          style={{ right: 0 }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); didResize.current = true; onResizeStart(e, leave, 'right'); }}
          title="Modifier la date de fin"
        />
      )}
    </div>
  );
}
