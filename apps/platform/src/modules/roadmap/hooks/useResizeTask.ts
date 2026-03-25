import { useState, useCallback, useRef, useEffect } from 'react';
import type { ViewMode } from '../types';
import { calculateDateFromPosition, getColumnWidth, parseDate, formatDate, getDaysBetween, getBusinessDaysBetween } from '../utils/dateUtils';

type ResizeDirection = 'left' | 'right';

interface UseResizeTaskOptions {
  taskId: string;
  startDate: string;
  endDate: string;
  chartStartDate: Date;
  viewMode: ViewMode;
  onResize: (taskId: string, newStart: string, newEnd: string) => void;
}

export function useResizeTask({ taskId, startDate, endDate, chartStartDate, viewMode, onResize }: UseResizeTaskOptions) {
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

    const getOffset = (date: Date): number => {
      if (viewMode === 'month') return getBusinessDaysBetween(chartStartDate, date);
      if (viewMode === 'quarter') return getDaysBetween(chartStartDate, date) / 7;
      return (date.getFullYear() - chartStartDate.getFullYear()) * 12 +
        (date.getMonth() - chartStartDate.getMonth()) + (date.getDate() - 1) / 30;
    };

    if (resizeDirection === 'left') {
      const startOff = getOffset(taskStart);
      newStartDate = calculateDateFromPosition((startOff * columnWidth) + leftOffset, chartStartDate, columnWidth, viewMode);
      if (newStartDate >= taskEnd) { newStartDate = new Date(taskEnd); newStartDate.setDate(newStartDate.getDate() - 1); }
    } else {
      const endOff = getOffset(taskEnd);
      newEndDate = calculateDateFromPosition((endOff * columnWidth) + widthOffset, chartStartDate, columnWidth, viewMode);
      if (newEndDate <= taskStart) { newEndDate = new Date(taskStart); newEndDate.setDate(newEndDate.getDate() + 1); }
    }

    onResize(taskId, formatDate(newStartDate), formatDate(newEndDate));
    setIsResizing(false);
    setResizeDirection(null);
    setLeftOffset(0);
    setWidthOffset(0);
  }, [isResizing, resizeDirection, taskId, startDate, endDate, chartStartDate, columnWidth, viewMode, leftOffset, widthOffset, onResize]);

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
