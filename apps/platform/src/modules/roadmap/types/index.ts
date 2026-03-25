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
  isWeekStart?: boolean;
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
