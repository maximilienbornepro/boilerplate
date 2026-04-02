import { useState, useCallback, useRef, useEffect } from 'react';
import type { ViewMode, TimeColumn } from '../types';
import { calculateDateFromPosition, getColumnWidth, parseDate, formatDate, getDaysBetween, calculatePixelOffset } from '../utils/dateUtils';

type ResizeDirection = 'left' | 'right';

interface UseResizeTaskOptions {
  taskId: string;
  startDate: string;
  endDate: string;
  chartStartDate: Date;
  viewMode: ViewMode;
  columns?: TimeColumn[];
  onResize: (taskId: string, newStart: string, newEnd: string) => void;
}

export function useResizeTask({ taskId, startDate, endDate, chartStartDate, viewMode, columns, onResize }: UseResizeTaskOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection | null>(null);
  const [leftOffset, setLeftOffset] = useState(0);
  const [widthOffset, setWidthOffset] = useState(0);

  const startXRef = useRef(0);
  const columnWidth = getColumnWidth(viewMode);

  const handleResizeStart = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    startXRef.current = e.clientX;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeDirection) return;
    const deltaX = e.clientX - startXRef.current;
    if (resizeDirection === 'left') {
      setLeftOffset(deltaX);
      setWidthOffset(-deltaX);
    } else {
      setWidthOffset(deltaX);
    }
  }, [isResizing, resizeDirection]);

  const handleMouseUp = useCallback(() => {
    if (!isResizing || !resizeDirection) return;

    const taskStart = parseDate(startDate);
    const taskEnd = parseDate(endDate);
    let newStartDate = taskStart;
    let newEndDate = taskEnd;

    const getPixelOffset = (date: Date): number => {
      if ((viewMode === 'month' || viewMode === 'year') && columns && columns.length > 0) {
        return calculatePixelOffset(date, columns, columnWidth);
      }
      if (viewMode === 'month') return getDaysBetween(chartStartDate, date) * columnWidth;
      if (viewMode === 'quarter') return (getDaysBetween(chartStartDate, date) / 7) * columnWidth;
      const monthOff = (date.getFullYear() - chartStartDate.getFullYear()) * 12 +
        (date.getMonth() - chartStartDate.getMonth()) + (date.getDate() - 1) / 30;
      return monthOff * columnWidth;
    };

    if (resizeDirection === 'left') {
      const startPx = getPixelOffset(taskStart);
      newStartDate = calculateDateFromPosition(startPx + leftOffset, chartStartDate, columnWidth, viewMode, columns);
      if (newStartDate >= taskEnd) { newStartDate = new Date(taskEnd); newStartDate.setDate(newStartDate.getDate() - 1); }
    } else {
      const endPx = getPixelOffset(taskEnd);
      newEndDate = calculateDateFromPosition(endPx + widthOffset, chartStartDate, columnWidth, viewMode, columns);
      if (newEndDate <= taskStart) { newEndDate = new Date(taskStart); newEndDate.setDate(newEndDate.getDate() + 1); }
    }

    onResize(taskId, formatDate(newStartDate), formatDate(newEndDate));
    setIsResizing(false);
    setResizeDirection(null);
    setLeftOffset(0);
    setWidthOffset(0);
  }, [isResizing, resizeDirection, taskId, startDate, endDate, chartStartDate, columnWidth, viewMode, columns, leftOffset, widthOffset, onResize]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return { isResizing, resizeDirection, leftOffset, widthOffset, handleResizeStart };
}
