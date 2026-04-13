export type ViewMode = 'month' | 'quarter' | 'year';

export interface Planning {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  planningId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  color: string;
  progress: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children?: Task[];
  isCollapsed?: boolean;
  /**
   * Per-task read-only flag. When true, drag/resize/edit/click on this
   * task is suppressed even if the global GanttBoard `readOnly` prop is
   * false. Used for virtual rows (delivery overlay).
   */
  readOnly?: boolean;
  /**
   * Marks a task that is NOT persisted in the DB — it has been injected
   * client-side from another data source (e.g. delivery overlay) and
   * must not be updated via the roadmap API.
   */
  isVirtual?: boolean;
  /** Where a virtual task comes from. Extensible for future integrations. */
  virtualSource?: 'delivery';
  /**
   * Render this task on a short row (24px instead of 80px) with a thin
   * bar and a single-line ellipsised name. Used for virtual delivery
   * leaves so hundreds of tickets don't take over the Gantt vertically.
   */
  compact?: boolean;
  /**
   * Workflow status for virtual delivery tasks — triggers a colored
   * status dot next to the task name in compact mode. Not used by real
   * roadmap tasks (those track progress as a 0-100 percentage instead).
   */
  status?: string;
  /** Jira metadata for hover card (virtual delivery tasks only) */
  jiraKey?: string;
  boardName?: string;
  estimatedDays?: number | null;
  assignee?: string | null;
  version?: string | null;
  source?: 'manual' | 'jira';
}

export interface LinkedDeliveryBoard {
  id: string;
  name: string;
  createdAt?: string;
}

export interface DeliveryOverlayTask {
  id: string;
  boardId: string;
  boardName: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  startDate: string;
  endDate: string;
  incrementId: string;
  /**
   * id of the delivery task this one is nested under (manual container →
   * Jira children). null for top-level delivery tasks.
   */
  parentTaskId: string | null;
}

export interface Dependency {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';
  createdAt: string;
}

export interface TaskPosition {
  taskId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimeColumn {
  date: Date;
  label: string;
  isToday: boolean;
  isWeekend: boolean;
  isHoliday?: boolean;
  isWeekStart?: boolean;
  width?: number;
}

export interface Marker {
  id: string;
  planningId: string;
  name: string;
  markerDate: string;
  color: string;
  type: string;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanningFormData {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
}

export interface TaskFormData {
  planningId: string;
  parentId: string | null;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  color: string;
  progress: number;
}
