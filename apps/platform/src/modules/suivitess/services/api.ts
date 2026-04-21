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

export type SourceProvider = 'fathom' | 'otter' | 'gmail' | 'outlook' | 'slack';

export interface BulkSourceItem {
  id: string;
  provider: SourceProvider;
  title: string;
  date: string | null;
  participants?: string[];
  preview?: string;
  /** True if this source has already been imported into any review of the user. */
  alreadyImported?: boolean;
}

// ── Sync meta + trigger (for the bulk import modal header) ───────────

export interface ProviderSyncMeta {
  configured: boolean;
  isActive?: boolean;
  lastSyncAt: string | null;
  messageCount: number;
  channelCount?: number;
  daysToFetch?: number;
  error?: string;
}
export interface SyncMetaResponse {
  slack: ProviderSyncMeta;
  outlook: ProviderSyncMeta;
}

export async function fetchSyncMeta(): Promise<SyncMetaResponse> {
  const r = await fetch(`${API_BASE}/transcription/sync-meta`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export interface SyncAllResponse {
  slack: { ok: boolean; total?: number; error?: string };
}

export async function triggerSyncAll(): Promise<SyncAllResponse> {
  const r = await fetch(`${API_BASE}/transcription/sync-all`, {
    method: 'POST', credentials: 'include',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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
export type SubjectAction = 'new-subject' | 'update-existing-subject';

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
  /** 'update-existing-subject' means we update `targetSubjectId` rather than creating. */
  subjectAction: SubjectAction;
  targetSubjectId: string | null;
  updatedSituation: string | null;
  updatedStatus: string | null;
  updatedResponsibility: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** Source context carried through so the frontend can forward it back
   *  to apply-routing — feeds the per-user pgvector routing memory. */
  sourceRawQuotes?: string[];
  sourceEntities?: string[];
  sourceParticipants?: string[];
  /** What the AI originally proposed before user edits. */
  aiProposedReviewId?: string | null;
  aiProposedReviewTitle?: string | null;
}

export interface AvailableReviewSubject {
  id: string;
  title: string;
  status: string | null;
  /** Full current situation text — surfaced so the bulk-import UI can
   *  show a preview of "last 4 lines + the append to come" when the
   *  user picks an existing subject to update. */
  situation?: string | null;
}

export interface AvailableReview {
  id: string;
  title: string;
  sections: Array<{ id: string; name: string; subjects: AvailableReviewSubject[] }>;
}

export interface AnalysisResponse {
  summary: string;
  subjects: AnalyzedSubject[];
  availableReviews: AvailableReview[];
  /** DB id of the ai_analysis_logs row — may be null if logging failed. */
  logId?: number | null;
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

// ── Async / polling variant with real progress updates ────────────────

export type PipelinePhase = 'queued' | 'tier1' | 'reconcile' | 'tier2' | 'tier3' | 'done' | 'error';

export interface PipelineJobStatus {
  id: string;
  phase: PipelinePhase;
  subjectsExtracted: number;
  /** Present only for multi-source jobs — subjects after T1.5 reconciliation. */
  subjectsConsolidated: number;
  sourcesCount: number;
  placementsProduced: number;
  t3Total: number;
  t3Done: number;
  durations: { t1?: number; reconcile?: number; t2?: number; t3?: number };
  rootLogId: number | null;
  result: unknown | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Same input as analyzeAndRoute, but non-blocking. Returns the jobId. */
export async function startAnalyzeAndRouteJob(payload: {
  source: SourceProvider;
  id: string;
  title: string;
  date?: string | null;
}): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/transcription/analyze-and-route-async`, {
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

export async function getPipelineJob(jobId: string): Promise<PipelineJobStatus> {
  const response = await fetch(`${API_BASE}/pipeline-jobs/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/** High-level helper : start + poll until done, firing a callback on
 *  every status update. Returns the final result (same shape as
 *  analyzeAndRoute). */
export async function analyzeAndRouteWithPolling(
  payload: { source: SourceProvider; id: string; title: string; date?: string | null },
  onStatus: (status: PipelineJobStatus) => void,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<AnalysisResponse> {
  const interval = opts.intervalMs ?? 500;
  const { jobId } = await startAnalyzeAndRouteJob(payload);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const status = await getPipelineJob(jobId);
    onStatus(status);
    if (status.phase === 'done') return status.result as AnalysisResponse;
    if (status.phase === 'error') throw new Error(status.error || 'Pipeline error');
    await new Promise<void>(r => setTimeout(r, interval));
  }
}

// ── Multi-source variant ──────────────────────────────────────────────

/** One source descriptor for the multi-source import endpoint. */
export interface MultiSourceDescriptor {
  source: SourceProvider;
  id: string;
  title: string;
  date?: string | null;
}

/** Per-proposal consolidation metadata — matches the backend's
 *  ConsolidatedSubject type. Used by the UI to surface "N sources"
 *  badges, chronology tooltips, and contradiction warnings. null when
 *  the proposal comes from a single-source subject (pass-through). */
export interface ConsolidationMeta {
  canonicalTitle: string;
  evidence: Array<{
    sourceId: string;
    sourceType: string;
    ts: string;
    subjectIndex: number;
    rawQuotes: string[];
    stance: 'propose' | 'confirm' | 'complement' | 'contradict';
    summary: string;
  }>;
  chronology: string | null;
  reconciliationNote: string | null;
}

/** Extended analysis response for the multi-source endpoint : same as
 *  AnalysisResponse + consolidation metadata aligned by proposal index. */
export interface MultiSourceAnalysisResponse extends AnalysisResponse {
  consolidationByProposal: Array<ConsolidationMeta | null>;
  sourcesCount: number;
}

export async function startMultiSourceAnalyzeJob(payload: {
  sources: MultiSourceDescriptor[];
}): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/multi-source/analyze-async`, {
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

/** Multi-source high-level helper : start + poll until done. Reuses
 *  `/pipeline-jobs/:id` for polling (same job tracker on the backend). */
export async function analyzeMultiSourceWithPolling(
  sources: MultiSourceDescriptor[],
  onStatus: (status: PipelineJobStatus) => void,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<MultiSourceAnalysisResponse> {
  const interval = opts.intervalMs ?? 500;
  const { jobId } = await startMultiSourceAnalyzeJob({ sources });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const status = await getPipelineJob(jobId);
    onStatus(status);
    if (status.phase === 'done') return status.result as MultiSourceAnalysisResponse;
    if (status.phase === 'error') throw new Error(status.error || 'Pipeline error');
    await new Promise<void>(r => setTimeout(r, interval));
  }
}

/** SSE-streamed variant : receives `journal-delta` events as the AI is
 *  writing its analysis journal, then `result` with the fully-parsed output,
 *  then `done`. Callbacks fire on every event. Returns the final result when
 *  the stream ends. */
export async function analyzeAndRouteStream(
  payload: { source: SourceProvider; id: string; title: string; date?: string | null },
  handlers: {
    onJournalDelta?: (text: string) => void;
    onJournalComplete?: () => void;
  },
): Promise<AnalysisResponse> {
  const response = await fetch(`${API_BASE}/transcription/analyze-and-route-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finalResult: AnalysisResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      if (!frame.startsWith('data: ')) continue;
      let evt: { type: string; [k: string]: unknown };
      try { evt = JSON.parse(frame.slice(6)); } catch { continue; }

      if (evt.type === 'journal-delta') {
        handlers.onJournalDelta?.(String(evt.text ?? ''));
      } else if (evt.type === 'journal-complete') {
        handlers.onJournalComplete?.();
      } else if (evt.type === 'result') {
        const result = evt.result as { summary: string; subjects: AnalyzedSubject[] };
        const availableReviews = evt.availableReviews as AvailableReview[];
        finalResult = { ...result, availableReviews };
      } else if (evt.type === 'error') {
        throw new Error(String(evt.message || 'Erreur IA'));
      }
    }
  }

  if (!finalResult) throw new Error('Flux interrompu avant la réponse finale');
  return finalResult;
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
  subjectAction?: SubjectAction;
  targetSubjectId?: string | null;
  updatedSituation?: string | null;
  updatedStatus?: string | null;
  updatedResponsibility?: string | null;
  /** Optional context the backend uses to feed the per-user routing
   *  memory (pgvector). Passing these lets future imports benefit from
   *  what the user just validated. Safe to omit — routing still works. */
  rawQuotes?: string[];
  entities?: string[];
  participants?: string[];
  /** What the AI originally proposed before the user's edits — used to
   *  track override rates in the memory for observability. */
  aiProposedReviewId?: string | null;
  aiProposedReviewTitle?: string | null;
}

export interface ApplyRoutingResponse {
  reviewsCreated: Array<{ id: string; title: string }>;
  sectionsCreated: Array<{ id: string; name: string; reviewId: string }>;
  subjectsCreated: Array<{ id: string; title: string; reviewId: string; sectionId: string }>;
  subjectsUpdated: Array<{ id: string; title: string }>;
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

// ==================== ADMIN — LEGACY BULLET CLEANUP ====================

export interface LegacyBulletCleanupRow {
  id: string;
  title: string;
  documentId: string;
  documentTitle: string;
  sectionName: string;
  before: string;
  after: string;
}

export interface LegacyBulletCleanupDryRun {
  mode: 'dry-run';
  totalScanned: number;
  rowsToClean: number;
  rows: LegacyBulletCleanupRow[];
  truncated: boolean;
}

export interface LegacyBulletCleanupApplied {
  mode: 'applied';
  totalScanned: number;
  rowsUpdated: number;
}

/** Admin-only. Scans every suivitess_subjects row and returns a preview
 *  of the changes that a cleanup run would apply. */
export async function previewLegacyBulletCleanup(): Promise<LegacyBulletCleanupDryRun> {
  const response = await fetch(`${API_BASE}/admin/cleanup-legacy-bullets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ apply: false }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/** Admin-only. Applies the cleanup inside a single DB transaction. */
export async function applyLegacyBulletCleanup(): Promise<LegacyBulletCleanupApplied> {
  const response = await fetch(`${API_BASE}/admin/cleanup-legacy-bullets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ apply: true }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ==================== REPLAY — rejouer un import depuis les logs ====================

export interface ReplayableRun {
  t2LogId: number;
  createdAt: string;
  proposalsCount: number;
  label: string;
  subjectsPreview: string[];
}

export async function listReplayableRuns(): Promise<ReplayableRun[]> {
  const res = await fetch(`${API_BASE}/transcription/replay/recent`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { runs: ReplayableRun[] };
  return data.runs;
}

export interface ReplayResponse {
  summary: string;
  subjects: AnalyzedSubject[];
  availableReviews: AvailableReview[];
  logId: number | null;
  replayedFromLogId: number;
}

/** Re-generate an "append to situation" text on demand — used when the
 *  user overrides the IA's routing in the bulk-import wizard (e.g.
 *  picks a different target subject) and we need a fresh append text
 *  adapted to the existing situation of that target. Runs the
 *  suivitess-append-situation skill server-side. */
export async function generateAppendText(params: {
  existingSituation: string;
  rawQuotes: string[];
  subjectTitle: string;
  sourceKind?: string;
  sourceTitle?: string;
}): Promise<{ appendText: string | null; logId: number | null }> {
  const res = await fetch(`${API_BASE}/transcription/generate-append-text`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Compose a new subject situation text on demand — used when the
 *  user overrides the IA's routing from update → create (the IA's
 *  original pipeline emits situation: '' for update proposals). */
export async function generateComposeText(params: {
  title: string;
  rawQuotes: string[];
  sourceKind?: string;
  sourceTitle?: string;
}): Promise<{ situation: string; logId: number | null }> {
  const res = await fetch(`${API_BASE}/transcription/generate-compose-text`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Document-scoped bulk analyze — async variant that returns a jobId
 *  immediately and runs the pipeline in the background. Same output
 *  shape as the global multi-source flow ; frontend polls
 *  /pipeline-jobs/:id to drive the progress indicator. Skips the
 *  place-in-reviews skill entirely (place-in-document only). */
export async function startAnalyzeDocumentBulkJob(
  docId: string,
  sources: Array<{ source: string; id: string; title: string; date?: string | null }>,
): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/documents/${docId}/bulk-analyze`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** High-level helper : start the doc-scoped job + poll until done,
 *  firing a callback on every status update so the modal can show
 *  the T1/T2/T3 progress indicator. Returns the same AnalysisResponse
 *  shape as the global bulk flow. */
export async function analyzeDocumentBulkWithPolling(
  docId: string,
  sources: Array<{ source: string; id: string; title: string; date?: string | null }>,
  onStatus: (status: PipelineJobStatus) => void,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<AnalysisResponse> {
  const interval = opts.intervalMs ?? 500;
  const { jobId } = await startAnalyzeDocumentBulkJob(docId, sources);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('aborted');
    const status = await getPipelineJob(jobId);
    onStatus(status);
    if (status.phase === 'done') return status.result as AnalysisResponse;
    if (status.phase === 'error') throw new Error(status.error || 'Pipeline error');
    await new Promise<void>(r => setTimeout(r, interval));
  }
}

/** Ask the AI to suggest a name for a new review / section / subject.
 *  Runs the suivitess-suggest-name skill server-side. Passing an
 *  `existingSuggestion` triggers a re-generation (the skill returns a
 *  different angle). */
export async function suggestName(params: {
  kind: 'review' | 'section' | 'subject';
  sourceTitle?: string;
  rawQuotes?: string[];
  entities?: string[];
  existingSuggestion?: string;
  parentReviewTitle?: string;
  parentSectionName?: string;
  sourceKind?: string;
}): Promise<{ name: string; logId: number | null }> {
  const res = await fetch(`${API_BASE}/transcription/suggest-name`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function replayRun(t2LogId: number): Promise<ReplayResponse> {
  const res = await fetch(`${API_BASE}/transcription/replay/${t2LogId}`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}
