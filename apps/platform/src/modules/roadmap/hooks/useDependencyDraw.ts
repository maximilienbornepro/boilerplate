import { useState, useCallback } from 'react';
import type { TaskPosition } from '../types';

export function useDependencyDraw(onCreateDependency: (fromTaskId: string, toTaskId: string) => void) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [fromTaskId, setFromTaskId] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  const startDrawing = useCallback((taskId: string) => {
    setIsDrawing(true);
    setFromTaskId(taskId);
  }, []);

  const updateMousePosition = useCallback((x: number, y: number) => {
    if (isDrawing) setMousePosition({ x, y });
  }, [isDrawing]);

  const endDrawing = useCallback((toTaskId: string | null) => {
    if (isDrawing && fromTaskId && toTaskId && fromTaskId !== toTaskId) {
      onCreateDependency(fromTaskId, toTaskId);
    }
    setIsDrawing(false);
    setFromTaskId(null);
    setMousePosition(null);
  }, [isDrawing, fromTaskId, onCreateDependency]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setFromTaskId(null);
    setMousePosition(null);
  }, []);

  return { isDrawing, fromTaskId, mousePosition, startDrawing, updateMousePosition, endDrawing, cancelDrawing };
}

export function calculateDependencyPath(from: TaskPosition, to: TaskPosition, type: string = 'finish-to-start'): string {
  let startX: number, endX: number;

  switch (type) {
    case 'start-to-start': startX = from.x; endX = to.x; break;
    case 'finish-to-finish': startX = from.x + from.width; endX = to.x + to.width; break;
    case 'start-to-finish': startX = from.x; endX = to.x + to.width; break;
    default: startX = from.x + from.width; endX = to.x; break;
  }

  const startY = from.y + from.height / 2;
  const endY = to.y + to.height / 2;
  const midX = startX + (endX - startX) / 2;

  return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
}

export function calculateArrowPosition(to: TaskPosition, type: string = 'finish-to-start'): { x: number; y: number; rotation: number } {
  const y = to.y + to.height / 2;
  switch (type) {
    case 'start-to-start':
    case 'finish-to-start': return { x: to.x, y, rotation: 180 };
    case 'finish-to-finish':
    case 'start-to-finish': return { x: to.x + to.width, y, rotation: 0 };
    default: return { x: to.x, y, rotation: 180 };
  }
}
