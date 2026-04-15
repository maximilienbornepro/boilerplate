import type { Document, Section, Subject, DocumentWithSections, SnapshotInfo, SnapshotDiff } from '../types';

const API_BASE = '/suivitess-api';

// ==================== CROSS-MODULE SEARCH ====================

export interface SubjectSearchResult {
  id: string;
  title: string;
  status: string;
  section_name: string;
  document_id: string;
  document_title: string;
}

export async function searchSubjects(q: string): Promise<SubjectSearchResult[]> {
  if (q.trim().length < 2) return [];
  const response = await fetch(`${API_BASE}/subjects/search?q=${encodeURIComponent(q)}`, {
    credentials: 'include',
  });
  if (!response.ok) return [];
  return response.json();
}

// ==================== DOCUMENTS ====================

export async function fetchDocuments(): Promise<Document[]> {
  const response = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch documents');
  return response.json();
}

export async function createDocument(title: string, description?: string, visibility?: 'private' | 'public'): Promise<Document> {
  const response = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description, visibility }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to create document');
  }
  return response.json();
}

export async function updateDocument(docId: string, data: { title?: string; description?: string | null }): Promise<Document> {
  const response = await fetch(`${API_BASE}/documents/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to update document');
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

// ==================== RECORDER ====================

export interface RecordingStatus {
  recordingId: number | null;
  status: 'idle' | 'joining' | 'recording' | 'processing' | 'done' | 'error';
  captionCount: number;
  startedAt: string | null;
  error: string | null;
}

export interface Suggestion {
  id: number;
  recordingId: number;
  documentId: string;
  type: 'new-subject' | 'update-situation' | 'new-section';
  targetSectionId: string | null;
  targetSubjectId: string | null;
  proposedTitle: string | null;
  proposedSituation: string | null;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export async function startRecording(docId: string, meetingUrl: string): Promise<{ recordingId: number; status: string }> {
  const response = await fetch(`${API_BASE}/documents/${docId}/recorder/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ meetingUrl }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(err.error || 'Impossible de démarrer l\'enregistrement');
  }
  return response.json();
}

export async function getRecordingStatus(docId: string): Promise<RecordingStatus> {
  const response = await fetch(`${API_BASE}/documents/${docId}/recorder/status`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch recorder status');
  return response.json();
}

export async function stopRecording(docId: string): Promise<void> {
  await fetch(`${API_BASE}/documents/${docId}/recorder/stop`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function fetchSuggestions(docId: string): Promise<Suggestion[]> {
  const response = await fetch(`${API_BASE}/documents/${docId}/suggestions`, { credentials: 'include' });
  if (!response.ok) return [];
  return response.json();
}

export async function acceptSuggestion(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/suggestions/${id}/accept`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to accept suggestion');
}

export async function rejectSuggestion(id: number): Promise<void> {
  await fetch(`${API_BASE}/suggestions/${id}/reject`, { method: 'POST', credentials: 'include' });
}

// ============ Bulk transcription import ============

export type SourceProvider = 'fathom' | 'otter' | 'gmail' | 'outlook';

export interface BulkSourceItem {
  id: string;
  provider: SourceProvider;
  title: string;
  date: string | null;
  participants?: string[];
  preview?: string;
}

export async function fetchBulkSources(days = 30): Promise<BulkSourceItem[]> {
  const response = await fetch(
    `${API_BASE}/transcription/bulk-sources?days=${days}`,
    { credentials: 'include' },
  );
  if (!response.ok) throw new Error('Failed to fetch bulk sources');
  return response.json();
}

// ============ Subject-level analysis & routing ============

export type ReviewAction = 'existing-review' | 'new-review';
export type SectionAction = 'existing-section' | 'new-section';

export interface AnalyzedSubject {
  title: string;
  situation: string;
  status: string;
  responsibility: string | null;
  action: ReviewAction;
  reviewId: string | null;
  suggestedNewReviewTitle: string | null;
  sectionAction: SectionAction;
  sectionId: string | null;
  suggestedNewSectionName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface AvailableReview {
  id: string;
  title: string;
  sections: Array<{ id: string; name: string }>;
}

export interface AnalysisResponse {
  summary: string;
  subjects: AnalyzedSubject[];
  availableReviews: AvailableReview[];
}

/**
 * Analyse the selected transcription and return extracted subjects, each
 * routed to a review + section (existing or new). One backend round-trip.
 */
export async function analyzeAndRoute(payload: {
  source: SourceProvider;
  id: string;
  title: string;
  date?: string | null;
}): Promise<AnalysisResponse> {
  const response = await fetch(`${API_BASE}/transcription/analyze-and-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export interface ApplyRoutingSubject {
  title: string;
  situation?: string;
  status?: string;
  responsibility?: string | null;
  targetReviewId?: string | null;
  newReviewTitle?: string | null;
  targetSectionId?: string | null;
  newSectionName?: string | null;
}

export interface ApplyRoutingResponse {
  reviewsCreated: Array<{ id: string; title: string }>;
  sectionsCreated: Array<{ id: string; name: string; reviewId: string }>;
  subjectsCreated: Array<{ id: string; title: string; reviewId: string; sectionId: string }>;
  errors: Array<{ title: string; error: string }>;
}

export async function applyRouting(
  sourceId: string,
  subjects: ApplyRoutingSubject[],
): Promise<ApplyRoutingResponse> {
  const response = await fetch(`${API_BASE}/transcription/apply-routing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sourceId, subjects }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}
