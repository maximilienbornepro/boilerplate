import type { Task } from '../types';

export function buildTaskHierarchy(tasks: Task[]): Task[] {
  const taskMap = new Map<string, Task>();
  const rootTasks: Task[] = [];

  for (const task of tasks) {
    taskMap.set(task.id, { ...task, children: [] });
  }

  for (const task of tasks) {
    const taskWithChildren = taskMap.get(task.id)!;
    if (task.parentId) {
      const parent = taskMap.get(task.parentId);
      if (parent) {
        parent.children!.push(taskWithChildren);
      } else {
        rootTasks.push(taskWithChildren);
      }
    } else {
      rootTasks.push(taskWithChildren);
    }
  }

  const sortTasks = (items: Task[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const item of items) {
      if (item.children && item.children.length > 0) sortTasks(item.children);
    }
  };

  sortTasks(rootTasks);

  const applyParentDates = (items: Task[]) => {
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        applyParentDates(item.children);
        const dates = calculateParentDates(item);
        if (dates) {
          item.startDate = dates.startDate;
          item.endDate = dates.endDate;
        }
      }
    }
  };

  applyParentDates(rootTasks);
  return rootTasks;
}

export function flattenHierarchy(
  tasks: Task[],
  collapsedIds: Set<string>,
  level: number = 0,
  ancestorIsLast: boolean[] = []
): { task: Task; level: number; ancestorIsLast: boolean[] }[] {
  const result: { task: Task; level: number; ancestorIsLast: boolean[] }[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const isLast = i === tasks.length - 1;
    const currentAncestorIsLast = [...ancestorIsLast, isLast];
    result.push({ task, level, ancestorIsLast: currentAncestorIsLast });

    if (task.children && task.children.length > 0 && !collapsedIds.has(task.id)) {
      result.push(...flattenHierarchy(task.children, collapsedIds, level + 1, currentAncestorIsLast));
    }
  }

  return result;
}

export function getDescendantIds(task: Task): string[] {
  const ids: string[] = [];
  if (task.children) {
    for (const child of task.children) {
      ids.push(child.id);
      ids.push(...getDescendantIds(child));
    }
  }
  return ids;
}

export function hasParentChildRelationship(tasks: Task[], taskId1: string, taskId2: string): boolean {
  const task1 = tasks.find(t => t.id === taskId1);
  const task2 = tasks.find(t => t.id === taskId2);
  if (!task1 || !task2) return false;

  let current: Task | undefined = task2;
  while (current?.parentId) {
    if (current.parentId === taskId1) return true;
    current = tasks.find(t => t.id === current!.parentId);
  }

  current = task1;
  while (current?.parentId) {
    if (current.parentId === taskId2) return true;
    current = tasks.find(t => t.id === current!.parentId);
  }

  return false;
}

export function calculateParentDates(task: Task): { startDate: string; endDate: string } | null {
  if (!task.children || task.children.length === 0) return null;

  let minStart = task.children[0].startDate;
  let maxEnd = task.children[0].endDate;

  for (const child of task.children) {
    if (child.startDate < minStart) minStart = child.startDate;
    if (child.endDate > maxEnd) maxEnd = child.endDate;
    const childDates = calculateParentDates(child);
    if (childDates) {
      if (childDates.startDate < minStart) minStart = childDates.startDate;
      if (childDates.endDate > maxEnd) maxEnd = childDates.endDate;
    }
  }

  return { startDate: minStart, endDate: maxEnd };
}

export const TASK_COLORS = [
  '#00bcd4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#14b8a6',
];

export function getNextColor(existingColors: string[]): string {
  const usedColors = new Set(existingColors);
  for (const color of TASK_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  return TASK_COLORS[existingColors.length % TASK_COLORS.length];
}
