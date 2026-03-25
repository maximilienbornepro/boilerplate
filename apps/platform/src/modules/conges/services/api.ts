import type { Member, Leave, LeaveFormData } from '../types';

const API_BASE = '/conges-api';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erreur inconnue' }));
    throw new Error(error.error || 'La requete a echoue');
  }
  return response.json();
}

// Members
export function fetchMembers(): Promise<Member[]> {
  return fetchApi('/members');
}

export function updateMember(id: number, data: Partial<{ color: string; sortOrder: number }>): Promise<{ success: boolean }> {
  return fetchApi(`/members/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Leaves
export function fetchLeaves(startDate: string, endDate: string): Promise<Leave[]> {
  return fetchApi(`/leaves?startDate=${startDate}&endDate=${endDate}`);
}

export function createLeave(data: LeaveFormData): Promise<Leave> {
  return fetchApi('/leaves', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateLeave(id: string, data: Partial<LeaveFormData>): Promise<Leave> {
  return fetchApi(`/leaves/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteLeave(id: string): Promise<{ success: boolean }> {
  return fetchApi(`/leaves/${id}`, { method: 'DELETE' });
}
