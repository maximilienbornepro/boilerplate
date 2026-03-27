const API_BASE = '/delivery-api';

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

// ============ Tasks CRUD ============

export interface TaskData {
  id: string;
  title: string;
  type: string;
  status: string;
  storyPoints: number | null;
  estimatedDays: number | null;
  assignee: string | null;
  priority: string;
  incrementId: string | null;
  sprintName: string | null;
}

export async function fetchTasks(incrementId: string): Promise<TaskData[]> {
  const response = await fetch(`${API_BASE}/tasks/${incrementId}`, { credentials: 'include' });
  return handleResponse<TaskData[]>(response);
}

export async function createTask(task: {
  title: string;
  type?: string;
  status?: string;
  storyPoints?: number;
  estimatedDays?: number;
  assignee?: string;
  priority?: string;
  incrementId?: string;
  sprintName?: string;
}): Promise<TaskData> {
  const response = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(task),
  });
  return handleResponse<TaskData>(response);
}

export async function updateTaskApi(id: string, updates: Record<string, unknown>): Promise<TaskData> {
  const response = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  });
  return handleResponse<TaskData>(response);
}

export async function deleteTaskApi(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to delete task');
  }
}

// ============ Positions ============

export interface TaskPosition {
  taskId: string;
  incrementId: string;
  startCol: number;
  endCol: number;
  row: number;
}

export async function saveTaskPosition(position: TaskPosition): Promise<void> {
  const response = await fetch(`${API_BASE}/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(position),
  });
  if (!response.ok) {
    throw new Error('Failed to save position');
  }
}

export async function getTaskPositions(incrementId: string): Promise<TaskPosition[]> {
  const response = await fetch(`${API_BASE}/positions/${incrementId}`, { credentials: 'include' });
  return handleResponse<TaskPosition[]>(response);
}

// ============ Increment State ============

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

export async function fetchIncrementState(incrementId: string): Promise<IncrementState> {
  const response = await fetch(`${API_BASE}/increment-state/${incrementId}`, { credentials: 'include' });
  return handleResponse<IncrementState>(response);
}

export async function toggleFreeze(incrementId: string): Promise<IncrementState> {
  const response = await fetch(`${API_BASE}/increment-state/${incrementId}/freeze`, {
    method: 'PUT',
    credentials: 'include',
  });
  return handleResponse<IncrementState>(response);
}

export async function hideTask(incrementId: string, taskId: string): Promise<{ hiddenTasks: HiddenTask[] }> {
  const response = await fetch(`${API_BASE}/increment-state/${incrementId}/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ taskId }),
  });
  return handleResponse<{ hiddenTasks: HiddenTask[] }>(response);
}

export async function restoreTasks(incrementId: string, taskIds: string[]): Promise<{ hiddenTasks: HiddenTask[] }> {
  const response = await fetch(`${API_BASE}/increment-state/${incrementId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ taskIds }),
  });
  return handleResponse<{ hiddenTasks: HiddenTask[] }>(response);
}

// ============ Snapshots ============

export type SnapshotSummary = {
  id: number;
  incrementId: string;
  createdAt: string;
  label: string;
  taskCount: number;
  hiddenCount: number;
};

export type SnapshotDetail = {
  id: number;
  incrementId: string;
  snapshotData: {
    taskPositions: {
      taskId: string;
      startCol: number;
      endCol: number;
      row: number;
    }[];
    incrementState: {
      isFrozen: boolean;
      hiddenTaskIds: string[];
      frozenAt: string | null;
    };
  };
  createdAt: string;
};

function getDayLabel(createdAt: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const snapshot = new Date(createdAt);
  snapshot.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - snapshot.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'J';
  return `J-${diffDays}`;
}

export async function fetchSnapshots(incrementId: string): Promise<SnapshotSummary[]> {
  const response = await fetch(`${API_BASE}/snapshots/${incrementId}`, { credentials: 'include' });
  const snapshots: SnapshotDetail[] = await handleResponse<SnapshotDetail[]>(response);

  return snapshots.map(s => ({
    id: s.id,
    incrementId: s.incrementId,
    createdAt: s.createdAt,
    label: getDayLabel(s.createdAt),
    taskCount: s.snapshotData.taskPositions.length,
    hiddenCount: s.snapshotData.incrementState.hiddenTaskIds.length,
  }));
}

export async function fetchSnapshotDetail(snapshotId: number): Promise<SnapshotDetail> {
  const response = await fetch(`${API_BASE}/snapshots/detail/${snapshotId}`, { credentials: 'include' });
  return handleResponse<SnapshotDetail>(response);
}

export async function restoreSnapshot(snapshotId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/snapshots/restore/${snapshotId}`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to restore snapshot');
}

export async function ensureDailySnapshot(incrementId: string): Promise<{ created: boolean; date: string }> {
  const response = await fetch(`${API_BASE}/snapshots/${incrementId}/ensure`, {
    method: 'POST',
    credentials: 'include',
  });
  return handleResponse<{ created: boolean; date: string }>(response);
}
