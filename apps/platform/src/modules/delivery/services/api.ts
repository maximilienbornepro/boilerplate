const API_BASE = '/delivery-api';

// ============ Jira Integration ============

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl?: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate?: string;
  endDate?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  storyPoints?: number;
  issueType: string;
  sprintName?: string;
}

export interface ActiveConnector {
  service: string;
  baseUrl?: string;
}

export async function fetchActiveConnectors(): Promise<ActiveConnector[]> {
  try {
    const response = await fetch('/api/connectors', { credentials: 'include' });
    if (!response.ok) return [];
    const connectors = await response.json() as { service: string; isActive: boolean; config: Record<string, string> }[];
    return connectors.filter(c => c.isActive).map(c => ({ service: c.service, baseUrl: c.config?.baseUrl }));
  } catch { return []; }
}

export async function fetchJiraSiteUrl(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/jira/check`, { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json() as { connected: boolean; siteUrl: string | null };
    return data.siteUrl ?? null;
  } catch { return null; }
}

export async function checkJiraConnected(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/jira/check`, { credentials: 'include' });
    if (!response.ok) return false;
    const data = await response.json() as { connected: boolean };
    return data.connected;
  } catch {
    return false;
  }
}

export async function fetchJiraProjects(): Promise<JiraProject[]> {
  const response = await fetch(`${API_BASE}/jira/projects`, { credentials: 'include' });
  return handleResponse<JiraProject[]>(response);
}

export async function fetchJiraSprints(projectKey: string): Promise<JiraSprint[]> {
  const response = await fetch(`${API_BASE}/jira/sprints?projectKey=${encodeURIComponent(projectKey)}`, { credentials: 'include' });
  return handleResponse<JiraSprint[]>(response);
}

export async function fetchJiraIssues(sprintIds: number[]): Promise<JiraIssue[]> {
  const response = await fetch(`${API_BASE}/jira/issues?sprintIds=${sprintIds.join(',')}`, { credentials: 'include' });
  return handleResponse<JiraIssue[]>(response);
}

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
  source: 'manual' | 'jira';
  parentTaskId: string | null;
  description?: string | null;
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
  source?: 'manual' | 'jira';
  description?: string | null;
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

// ============ Nesting ============

export async function nestTaskApi(childId: string, parentId: string): Promise<TaskData> {
  const response = await fetch(`${API_BASE}/tasks/${childId}/nest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ parentId }),
  });
  return handleResponse<TaskData>(response);
}

export async function unnestTaskApi(childId: string): Promise<TaskData> {
  const response = await fetch(`${API_BASE}/tasks/${childId}/unnest`, {
    method: 'POST',
    credentials: 'include',
  });
  return handleResponse<TaskData>(response);
}

// ============ Positions ============

export interface TaskPosition {
  taskId: string;
  incrementId: string;
  startCol: number;
  endCol: number;
  row: number;
  rowSpan?: number;
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

// ============ Boards ============

export type BoardType = 'agile' | 'calendaire';

export interface Board {
  id: string;
  userId: number;
  name: string;
  description: string | null;
  boardType: BoardType;
  startDate: string | null;
  endDate: string | null;
  durationWeeks: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchBoards(): Promise<Board[]> {
  const res = await fetch(`${API_BASE}/boards`, { credentials: 'include' });
  return handleResponse<Board[]>(res);
}

export async function fetchBoard(id: string): Promise<Board> {
  const res = await fetch(`${API_BASE}/boards/${id}`, { credentials: 'include' });
  return handleResponse<Board>(res);
}

export async function createBoard(
  name: string,
  boardType: BoardType,
  startDate: string,
  durationWeeks?: number,
  description?: string,
  visibility?: 'private' | 'public',
): Promise<Board> {
  const res = await fetch(`${API_BASE}/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, description, boardType, startDate, durationWeeks, visibility }),
  });
  return handleResponse<Board>(res);
}

export async function updateBoardApi(id: string, data: { name?: string; description?: string | null }): Promise<Board> {
  const res = await fetch(`${API_BASE}/boards/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return handleResponse<Board>(res);
}

export async function deleteBoardApi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/boards/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}

// Fetch ALL tasks for a board (across all sprints) — used by the new
// board-level view where all sprints are visible simultaneously.
export async function fetchTasksForBoard(boardId: string): Promise<Task[]> {
  const res = await fetch(`${API_BASE}/tasks/board/${boardId}`, { credentials: 'include' });
  return handleResponse<Task[]>(res);
}

export async function fetchPositionsForBoard(boardId: string): Promise<TaskPosition[]> {
  const res = await fetch(`${API_BASE}/positions/board/${boardId}`, { credentials: 'include' });
  return handleResponse<TaskPosition[]>(res);
}

// Fetch Jira fix versions (releases) for given project keys, filtered by date range
export async function fetchJiraVersions(
  projectKeys: string[],
  startDate?: string,
  endDate?: string,
): Promise<Array<{ id: string; version: string; date: string; projectKey: string }>> {
  const params = new URLSearchParams({ projectKeys: projectKeys.join(',') });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  const res = await fetch(`${API_BASE}/jira/versions?${params}`, { credentials: 'include' });
  return handleResponse(res);
}

// ============ AI Sanity Check ============

export type VersionCategory = 'next' | 'later' | 'past' | 'none';

export interface VersionInfo {
  name: string;
  releaseDate: string | null;
  category: VersionCategory;
}

export interface AnalyzedTask {
  taskId: string;
  taskTitle: string;
  /** External reference (Jira key, ClickUp id, Linear ref, …). */
  externalKey: string | null;
  /** Source tool (`'jira'`, `'clickup'`, `'linear'`, …). */
  source: string;
  status: string;
  version: string | null;
  versionCategory: VersionCategory;
  hasEstimation: boolean;
  hasDescription: boolean;
  current: { startCol: number; endCol: number; row: number };
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
}

export interface ProposedAddition {
  externalKey: string;
  source: string;
  summary: string;
  status: string;
  version: string | null;
  versionCategory: VersionCategory;
  hasEstimation: boolean;
  hasDescription: boolean;
  storyPoints: number | null;
  estimatedDays: number | null;
  assignee: string | null;
  iterationName: string | null;
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
}

export interface ColumnPlan {
  col: number;
  label: string;
  strategy: string;
  tasks: AnalyzedTask[];
  additions: ProposedAddition[];
}

export interface BoardAnalysis {
  totalJiraTasks: number;
  byStatus: Record<string, number>;
  missingEstimation: number;
  missingDescription: number;
  missingFromBoard: number;
  versions: VersionInfo[];
}

export interface SanityCheckResponse {
  summary: string;
  analysis: BoardAnalysis;
  columns: ColumnPlan[];
}

/** @deprecated kept for type compatibility with older callers. */
export interface SanityMoveRecommendation {
  taskId: string;
  taskTitle: string;
  current: { startCol: number; endCol: number; row: number };
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

export async function runSanityCheck(boardId: string): Promise<SanityCheckResponse> {
  const res = await fetch(`${API_BASE}/boards/${boardId}/ai-sanity-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  return handleResponse<SanityCheckResponse>(res);
}

export interface SanityAdditionPayload {
  externalKey: string;
  source: string;
  summary: string;
  status?: string;
  storyPoints?: number | null;
  estimatedDays?: number | null;
  assignee?: string | null;
  iterationName?: string | null;
  version?: string | null;
  startCol: number;
  endCol: number;
  row: number;
}

export async function applySanityMoves(
  boardId: string,
  moves: Array<{ taskId: string; startCol: number; endCol: number; row: number }>,
  additions: SanityAdditionPayload[] = [],
): Promise<{ applied: number; movesApplied: number; additionsApplied: number }> {
  const res = await fetch(`${API_BASE}/boards/${boardId}/ai-sanity-check/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ moves, additions }),
  });
  return handleResponse<{ applied: number; movesApplied: number; additionsApplied: number }>(res);
}
