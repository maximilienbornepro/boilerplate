import type { Planning, Task, Dependency, Marker, PlanningFormData, TaskFormData } from '../types';

const API_BASE = '/roadmap-api';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erreur inconnue' }));
    throw new Error(error.error || 'La requete a echoue');
  }
  return response.json();
}

// Plannings
export const fetchPlannings = (): Promise<Planning[]> => fetchApi('/plannings');
export const fetchPlanning = (id: string): Promise<Planning> => fetchApi(`/plannings/${id}`);
export const createPlanning = (data: PlanningFormData): Promise<Planning> => fetchApi('/plannings', { method: 'POST', body: JSON.stringify(data) });
export const updatePlanning = (id: string, data: Partial<PlanningFormData>): Promise<Planning> => fetchApi(`/plannings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePlanning = (id: string): Promise<{ success: boolean }> => fetchApi(`/plannings/${id}`, { method: 'DELETE' });

// Tasks
export const fetchTasks = (planningId: string): Promise<Task[]> => fetchApi(`/plannings/${planningId}/tasks`);
export const fetchTask = (id: string): Promise<Task> => fetchApi(`/tasks/${id}`);
export const createTask = (data: TaskFormData): Promise<Task> => fetchApi('/tasks', { method: 'POST', body: JSON.stringify(data) });
export const updateTask = (id: string, data: Partial<TaskFormData & { sortOrder: number }>): Promise<Task> => fetchApi(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTask = (id: string): Promise<{ success: boolean }> => fetchApi(`/tasks/${id}`, { method: 'DELETE' });

// Dependencies
export const fetchDependencies = (planningId: string): Promise<Dependency[]> => fetchApi(`/plannings/${planningId}/dependencies`);
export const createDependency = (fromTaskId: string, toTaskId: string, type?: string): Promise<Dependency> => fetchApi('/dependencies', { method: 'POST', body: JSON.stringify({ fromTaskId, toTaskId, type: type || 'finish-to-start' }) });
export const deleteDependency = (id: string): Promise<{ success: boolean }> => fetchApi(`/dependencies/${id}`, { method: 'DELETE' });

// Markers
export const fetchMarkers = (planningId: string): Promise<Marker[]> => fetchApi(`/plannings/${planningId}/markers`);
export const createMarker = (planningId: string, name: string, markerDate: string, color?: string, type?: string): Promise<Marker> => fetchApi('/markers', { method: 'POST', body: JSON.stringify({ planningId, name, markerDate, color, type }) });
export const updateMarker = (id: string, data: Partial<{ name: string; markerDate: string; color: string; type: string; taskId: string | null }>): Promise<Marker> => fetchApi(`/markers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteMarker = (id: string): Promise<{ success: boolean }> => fetchApi(`/markers/${id}`, { method: 'DELETE' });

// Embed (public)
export const fetchPlanningEmbed = (id: string): Promise<Planning> => fetchApi(`/embed/${id}`);
export const fetchTasksEmbed = (planningId: string): Promise<Task[]> => fetchApi(`/embed/${planningId}/tasks`);
export const fetchDependenciesEmbed = (planningId: string): Promise<Dependency[]> => fetchApi(`/embed/${planningId}/dependencies`);
export const fetchMarkersEmbed = (planningId: string): Promise<Marker[]> => fetchApi(`/embed/${planningId}/markers`);
