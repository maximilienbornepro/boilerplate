import { useCallback, useRef } from 'react';
import type { Task, ViewMode } from '../types';
import { calculateDateFromPosition, getColumnWidth, parseDate, formatDate, getDaysBetween, getBusinessDaysBetween } from '../utils/dateUtils';

interface TopLevelTaskRow {
  task: Task;
  rowIndex: number;
}

interface UseDragMarkerOptions {
  markerId: string;
  markerDate: string;
  chartStartDate: Date;
  viewMode: ViewMode;
  onMove: (markerId: string, newDate: string, taskId: string | null) => void;
  topLevelTaskRows?: TopLevelTaskRow[];
  rowHeight?: number;
  currentTaskId?: string | null;
}

const DRAG_THRESHOLD = 5;

export function useDragMarker({ markerId, markerDate, chartStartDate, viewMode, onMove, topLevelTaskRows, rowHeight = 64, currentTaskId }: UseDragMarkerOptions) {
  const markerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const snappedTaskIdRef = useRef<string | null>(currentTaskId ?? null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const columnWidth = getColumnWidth(viewMode);

  const findClosestTaskRow = useCallback((mouseY: number, containerRect: DOMRect): TopLevelTaskRow | null => {
    if (!topLevelTaskRows || topLevelTaskRows.length === 0) return null;
    const relativeY = mouseY - containerRect.top;
    let closest: TopLevelTaskRow | null = null;
    let closestDistance = Infinity;
    for (const row of topLevelTaskRows) {
      const rowCenter = row.rowIndex * rowHeight + rowHeight / 2;
      const distance = Math.abs(relativeY - rowCenter);
      if (distance < rowHeight * 1.5 && distance < closestDistance) { closestDistance = distance; closest = row; }
    }
    return closest;
  }, [topLevelTaskRows, rowHeight]);

  const showSnapHighlight = useCallback((rowIndex: number, container: HTMLElement) => {
    if (!highlightRef.current) {
      highlightRef.current = document.createElement('div');
      highlightRef.current.style.cssText = `position:absolute;left:0;right:0;height:${rowHeight}px;background:rgba(245,158,11,0.08);border-top:1px dashed rgba(245,158,11,0.4);border-bottom:1px dashed rgba(245,158,11,0.4);pointer-events:none;z-index:5;transition:top 0.15s ease;`;
      container.appendChild(highlightRef.current);
    }
    highlightRef.current.style.top = `${rowIndex * rowHeight}px`;
    highlightRef.current.style.display = 'block';
  }, [rowHeight]);

  const hideSnapHighlight = useCallback(() => { if (highlightRef.current) highlightRef.current.style.display = 'none'; }, []);
  const removeSnapHighlight = useCallback(() => { if (highlightRef.current) { highlightRef.current.remove(); highlightRef.current = null; } }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !markerRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const deltaY = e.clientY - startYRef.current;
    markerRef.current.style.transform = `translateX(${deltaX}px)`;
    if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) hasDraggedRef.current = true;

    if (topLevelTaskRows && topLevelTaskRows.length > 0) {
      const container = markerRef.current.parentElement;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const adjustedY = e.clientY + container.scrollTop;
        const adjustedRect = { ...containerRect, top: containerRect.top + container.scrollTop } as DOMRect;
        const closestRow = findClosestTaskRow(adjustedY, adjustedRect);
        if (closestRow) { snappedTaskIdRef.current = closestRow.task.id; showSnapHighlight(closestRow.rowIndex, container); }
        else { snappedTaskIdRef.current = null; hideSnapHighlight(); }
      }
    }
  }, [topLevelTaskRows, findClosestTaskRow, showSnapHighlight, hideSnapHighlight]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const currentDate = parseDate(markerDate);
    let startOffset: number;
    if (viewMode === 'month') startOffset = getBusinessDaysBetween(chartStartDate, currentDate);
    else if (viewMode === 'quarter') startOffset = getDaysBetween(chartStartDate, currentDate) / 7;
    else startOffset = (currentDate.getFullYear() - chartStartDate.getFullYear()) * 12 + (currentDate.getMonth() - chartStartDate.getMonth()) + (currentDate.getDate() - 1) / 30;

    const newDate = calculateDateFromPosition(deltaX + (startOffset * columnWidth), chartStartDate, columnWidth, viewMode);

    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    removeSnapHighlight();

    if (hasDraggedRef.current) {
      onMove(markerId, formatDate(newDate), snappedTaskIdRef.current);
      requestAnimationFrame(() => { requestAnimationFrame(() => { if (markerRef.current) markerRef.current.style.transform = ''; }); });
    } else {
      if (markerRef.current) markerRef.current.style.transform = '';
    }
  }, [markerId, markerDate, chartStartDate, columnWidth, viewMode, onMove, handleMouseMove, removeSnapHighlight]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    snappedTaskIdRef.current = currentTaskId ?? null;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [handleMouseMove, handleMouseUp, currentTaskId]);

  return { markerRef, handleMouseDown };
}
