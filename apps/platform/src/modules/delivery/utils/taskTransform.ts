import type { Task } from '../types';
import type { TaskData } from '../services/api';

/**
 * Represents a saved position for a task on the board grid.
 */
export interface SavedPosition {
  taskId: string;
  startCol: number;
  endCol: number;
  row: number;
}

/**
 * Grid placement for a task without a saved position.
 */
interface DefaultPlacement {
  startCol: number;
  endCol: number;
  row: number;
}

/**
 * Transform a local task (from DB) into a Task object for the board,
 * using a saved position if available.
 * If no saved position exists, uses the provided default placement.
 *
 * @param taskData - The task data from API
 * @param savedPosition - Previously saved board position, or undefined
 * @param defaultPlacement - Grid placement to use when no saved position exists
 */
export function transformTask(
  taskData: TaskData,
  savedPosition: SavedPosition | undefined,
  defaultPlacement: DefaultPlacement,
): Task {
  const base: Task = {
    id: taskData.id,
    title: taskData.title,
    type: (taskData.type as Task['type']) || 'feature',
    status: (taskData.status as Task['status']) || 'todo',
    storyPoints: taskData.storyPoints ?? undefined,
    estimatedDays: taskData.estimatedDays,
    assignee: taskData.assignee,
    priority: taskData.priority,
    incrementId: taskData.incrementId ?? undefined,
    sprintName: taskData.sprintName,
  };

  if (savedPosition) {
    return {
      ...base,
      startCol: savedPosition.startCol,
      endCol: savedPosition.endCol,
      row: savedPosition.row,
    };
  }

  return {
    ...base,
    startCol: defaultPlacement.startCol,
    endCol: defaultPlacement.endCol,
    row: defaultPlacement.row,
  };
}
