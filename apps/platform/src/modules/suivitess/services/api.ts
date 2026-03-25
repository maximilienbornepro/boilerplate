import type { Document, Section, Subject, DocumentWithSections, SnapshotInfo, SnapshotDiff } from '../types';

const API_BASE = '/suivitess-api';

// ==================== DOCUMENTS ====================

export async function fetchDocuments(): Promise<Document[]> {
  const response = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch documents');
  return response.json();
}

export async function createDocument(title: string): Promise<Document> {
  const response = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create document');
  }
  return response.json();
}

export async function fetchDocument(docId: string): Promise<DocumentWithSections> {
  const response = await fetch(`${API_BASE}/documents/${docId}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch document');
  return response.json();
}

export async function deleteDocument(docId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${docId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to delete document');
  }
}

// ==================== SECTIONS ====================

export async function createSection(docId: string, name: string): Promise<Section> {
  const response = await fetch(`${API_BASE}/documents/${docId}/sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create section');
  }
  return response.json();
}

export async function updateSection(sectionId: string, updates: { name?: string; position?: number }): Promise<Section> {
  const response = await fetch(`${API_BASE}/sections/${sectionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to update section');
  }
  return response.json();
}

export async function deleteSection(sectionId: string): Promise<{ deletedSubjects: number }> {
  const response = await fetch(`${API_BASE}/sections/${sectionId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to delete section');
  }
  return response.json();
}

export async function reorderSections(docId: string, sectionIds: string[]): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${docId}/sections/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sectionIds }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to reorder sections');
  }
}

// ==================== SUBJECTS ====================

export interface CreateSubjectParams {
  title: string;
  situation?: string;
  status?: string;
  responsibility?: string;
}

export async function createSubject(sectionId: string, params: CreateSubjectParams): Promise<Subject> {
  const response = await fetch(`${API_BASE}/sections/${sectionId}/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create subject');
  }
  return response.json();
}

export interface UpdateSubjectParams {
  title?: string;
  situation?: string;
  status?: string;
  responsibility?: string;
  sectionId?: string;  // To move to different section
  position?: number;   // To reorder within section
}

export async function updateSubject(subjectId: string, params: UpdateSubjectParams): Promise<Subject> {
  const response = await fetch(`${API_BASE}/subjects/${subjectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to update subject');
  }
  return response.json();
}

export async function deleteSubject(subjectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/subjects/${subjectId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to delete subject');
  }
}

export async function reorderSubjects(sectionId: string, subjectIds: string[]): Promise<void> {
  const response = await fetch(`${API_BASE}/sections/${sectionId}/subjects/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subjectIds }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to reorder subjects');
  }
}

// ==================== SNAPSHOTS ====================

export async function createSnapshot(docId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${docId}/snapshots`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create snapshot');
  }
}

export async function getDocumentHistory(docId: string): Promise<SnapshotInfo[]> {
  const response = await fetch(`${API_BASE}/documents/${docId}/snapshots`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

export async function getSnapshot(snapshotId: number): Promise<{ data: DocumentWithSections; created_at: string }> {
  const response = await fetch(`${API_BASE}/snapshots/${snapshotId}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch snapshot');
  return response.json();
}

export async function restoreSnapshot(snapshotId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/snapshots/${snapshotId}/restore`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to restore snapshot');
  }
}

export async function getSnapshotDiff(docId: string): Promise<SnapshotDiff> {
  const response = await fetch(`${API_BASE}/documents/${docId}/diff`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch diff');
  return response.json();
}
