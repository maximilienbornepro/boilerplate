import { useCallback, useRef } from 'react';
import type { ViewMode, TimeColumn } from '../types';
import { calculateDateFromPosition, getColumnWidth, parseDate, formatDate, getDaysBetween, calculatePixelOffset, addDays } from '../utils/dateUtils';

interface UseDragTaskOptions {
  taskId: string;
  startDate: string;
  endDate: string;
  chartStartDate: Date;
  viewMode: ViewMode;
  columns?: TimeColumn[];
  onMove: (taskId: string, newStart: string, newEnd: string) => void;
}

const DRAG_THRESHOLD = 5;

export function useDragTask({ taskId, startDate, endDate, chartStartDate, viewMode, columns, onMove }: UseDragTaskOptions) {
  const taskBarRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const isDraggingRef = useRef(false);

  const columnWidth = getColumnWidth(viewMode);
  // Always use calendar days for duration (month view now uses uniform 28px columns like Congés)
  const taskDuration = getDaysBetween(parseDate(startDate), parseDate(endDate));

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !taskBarRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    taskBarRef.current.style.transform = `translateX(${deltaX}px)`;
    if (Math.abs(deltaX) > DRAG_THRESHOLD) hasDraggedRef.current = true;
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;

    const deltaX = e.clientX - startXRef.current;
    const currentStart = parseDate(startDate);
    let startPixel: number;

    if ((viewMode === 'month' || viewMode === 'year') && columns && columns.length > 0) {
      startPixel = calculatePixelOffset(currentStart, columns, columnWidth);
    } else if (viewMode === 'month') {
      startPixel = getDaysBetween(chartStartDate, currentStart) * columnWidth;
    } else if (viewMode === 'quarter') {
      startPixel = (getDaysBetween(chartStartDate, currentStart) / 7) * columnWidth;
    } else {
      const monthOff = (currentStart.getFullYear() - chartStartDate.getFullYear()) * 12 +
        (currentStart.getMonth() - chartStartDate.getMonth()) + (currentStart.getDate() - 1) / 30;
      startPixel = monthOff * columnWidth;
    }

    const newStartDate = calculateDateFromPosition(deltaX + startPixel, chartStartDate, columnWidth, viewMode, columns);
    const newEndDate = addDays(newStartDate, taskDuration);

    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (hasDraggedRef.current) {
      onMove(taskId, formatDate(newStartDate), formatDate(newEndDate));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { if (taskBarRef.current) taskBarRef.current.style.transform = ''; });
      });
    } else {
      if (taskBarRef.current) taskBarRef.current.style.transform = '';
    }
  }, [taskId, startDate, chartStartDate, columnWidth, viewMode, taskDuration, onMove, handleMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-dependency-handle]') || target.closest('[data-resize-handle]')) return;

    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.clientX;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [handleMouseMove, handleMouseUp]);

  return { taskBarRef, handleMouseDown };
}
