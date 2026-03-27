export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type TaskType = 'feature' | 'tech' | 'bug' | 'milestone';

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  startCol?: number;
  endCol?: number;
  row?: number;
  storyPoints?: number;
  estimatedDays?: number | null;
  assignee?: string | null;
  priority?: string;
  incrementId?: string;
  sprintName?: string | null;
  // Orphan tracking (task not in active sprints)
  isOrphan?: boolean;
}

export interface Release {
  id: string;
  date: string;
  version: string;
}

export interface HiddenTask {
  taskId: string;
  title?: string;
  sprintName?: string;
}

export interface IncrementState {
  incrementId: string;
  isFrozen: boolean;
  hiddenTaskIds: string[];
  hiddenTasks: HiddenTask[];
  frozenAt: string | null;
}
