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
  rowSpan?: number;
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
    source: taskData.source || 'manual',
    parentTaskId: taskData.parentTaskId,
  };

  if (savedPosition) {
    return {
      ...base,
      startCol: savedPosition.startCol,
      endCol: savedPosition.endCol,
      row: savedPosition.row,
      rowSpan: savedPosition.rowSpan || 1,
    };
  }

  return {
    ...base,
    startCol: defaultPlacement.startCol,
    endCol: defaultPlacement.endCol,
    row: defaultPlacement.row,
    rowSpan: 1,
  };
}

/**
 * Build parent-child tree from a flat task list.
 * Returns only top-level tasks (no parentTaskId).
 * Children are populated in their parent's `children` array.
 */
export function buildTaskTree(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t, children: [] as Task[] }]));
  const topLevel: Task[] = [];

  for (const task of taskMap.values()) {
    if (task.parentTaskId && taskMap.has(task.parentTaskId)) {
      taskMap.get(task.parentTaskId)!.children!.push(task);
    } else {
      topLevel.push(task);
    }
  }

  return topLevel;
}

/**
 * Compute the row span for a container based on child count.
 */
export function computeContainerRowSpan(childCount: number): number {
  if (childCount === 0) return 1;
  return Math.ceil(childCount / 2) + 1;
}
