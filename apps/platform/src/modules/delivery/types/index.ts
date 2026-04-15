export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type TaskType = 'feature' | 'tech' | 'bug' | 'milestone';

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Source of a task on the delivery board.
 * - 'manual' : created by the user directly in the UI.
 * - Any other string (e.g. 'jira', 'clickup', 'linear', 'asana') : imported
 *   from an external tool. The sanity-check feature treats every non-'manual'
 *   source as an external ticket and runs its AI analysis on it.
 */
export type TaskSource = 'manual' | 'jira' | 'clickup' | 'linear' | 'asana' | 'trello' | string;

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  startCol?: number;
  endCol?: number;
  row?: number;
  rowSpan?: number;
  storyPoints?: number;
  estimatedDays?: number | null;
  assignee?: string | null;
  priority?: string;
  incrementId?: string;
  sprintName?: string | null;
  source: TaskSource;
  parentTaskId?: string | null;
  children?: Task[];
  description?: string | null;
  // Orphan tracking (task not in active sprints)
  isOrphan?: boolean;
}

export interface Release {
  id: string;
  date: string;
  version: string;
  /** Jira project key (e.g. TVFIRE) — used for per-project coloring. */
  projectKey?: string;
  /** Hex color for this marker. */
  color?: string;
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
