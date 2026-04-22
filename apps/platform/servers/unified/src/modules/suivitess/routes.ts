import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import type { DocumentWithSections } from './dbService.js';
import * as recorder from './recorderService.js';
import { acceptSuggestion } from './suggestionsService.js';

// Fields we control directly via the modal — skip these in createmeta output
const STANDARD_JIRA_FIELDS = new Set(['summary', 'description', 'project', 'issuetype', 'reporter', 'attachment', 'issuelinks']);

interface JiraFieldMeta {
  name?: string;
  required: boolean;
  schema?: { type: string; items?: string };
  allowedValues?: Array<{ id: string; name?: string; value?: string }>;
}

function serializeFields(fields: Record<string, JiraFieldMeta>): Array<{
  id: string;
  name: string;
  required: boolean;
  type: string;
  items: string | null;
  allowedValues: Array<{ id: string; label: string }> | null;
}> {
  return Object.entries(fields)
    .filter(([id, f]) => f.required && !STANDARD_JIRA_FIELDS.has(id))
    .map(([id, f]) => ({
      id,
      name: f.name || id,
      required: f.required,
      type: f.schema?.type || 'string',
      items: f.schema?.items || null,
      allowedValues: f.allowedValues ? f.allowedValues.map(v => ({ id: v.id, label: v.name || v.value || v.id })) : null,
    }));
}

/** Subset of the frontend's AnalyzedSubject shape — mirrors
 *  FinalReviewProposal but scoped to the document-bulk flow so we
 *  don't have to import that type into this file. */
interface FinalReviewProposalAdapted {
  title: string;
  situation: string;
  status: string;
  responsibility: string | null;
  action: 'existing-review';
  reviewId: string;
  suggestedNewReviewTitle: null;
  sectionAction: 'new-section' | 'existing-section';
  sectionId: string | null;
  suggestedNewSectionName: string | null;
  subjectAction: 'new-subject' | 'update-existing-subject';
  targetSubjectId: string | null;
  updatedSituation: string | null;
  updatedStatus: string | null;
  updatedResponsibility: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  sourceRawQuotes: string[];
  sourceEntities: string[];
  sourceParticipants: string[];
  aiProposedReviewId: string;
  aiProposedReviewTitle: null;
}

/** Adapt a FinalDocumentProposal (from the place-in-document pipeline)
 *  to one or more FinalReviewProposal-shaped entries so the bulk-
 *  import modal can render them with no special-case. Review is
 *  pinned to the scoping document so the frontend's review dropdown
 *  stays locked on it. `create_section` fans out one entry per
 *  subject (the backend groups them under a single new section). */
/** Lookup the sectionId that contains a given subjectId in a doc's
 *  sections snapshot. Used by the enrich adapter since the pipeline
 *  only carries sectionName for enrich proposals. */
function resolveSectionIdForSubject(
  sections: Array<{ id: string; subjects: Array<{ id: string }> }>,
  subjectId: string | undefined,
): string | null {
  if (!subjectId) return null;
  for (const s of sections) {
    if (s.subjects.some(sub => sub.id === subjectId)) return s.id;
  }
  return null;
}

function adaptDocProposalToReviewShape(
  p: {
    action: 'enrich' | 'create_subject' | 'create_section';
    subjectId?: string;
    subjectTitle?: string;
    sectionId?: string;
    sectionName?: string;
    title?: string;
    situation?: string;
    appendText?: string;
    responsibility?: string | null;
    status?: string;
    subjects?: Array<{ title: string; situation: string; responsibility: string | null; status: string }>;
    reason: string;
    sourceRawQuotes?: string[];
    sourceEntities?: string[];
    sourceParticipants?: string[];
  },
  docId: string,
  docSections: Array<{ id: string; subjects: Array<{ id: string }> }>,
): FinalReviewProposalAdapted[] {
  const baseReview = {
    action: 'existing-review' as const,
    reviewId: docId,
    suggestedNewReviewTitle: null as null,
    aiProposedReviewId: docId,
    aiProposedReviewTitle: null as null,
    confidence: 'high' as const,
    reasoning: p.reason,
    // Plumbed from the extraction so the frontend can feed them back
    // to /apply-routing (routing memory) + to the regeneration skills
    // (suggest-name, generate-append-text, generate-compose-text)
    // when the user overrides the IA's target.
    sourceRawQuotes: p.sourceRawQuotes ?? [],
    sourceEntities: p.sourceEntities ?? [],
    sourceParticipants: p.sourceParticipants ?? [],
  };

  if (p.action === 'enrich') {
    return [{
      ...baseReview,
      title: p.subjectTitle ?? '',
      situation: '', // unused for updates
      status: 'en-cours',
      responsibility: null,
      sectionAction: 'existing-section',
      // Resolve sectionId from the doc by matching the target subject.
      // The FinalDocumentProposal for enrich only carries sectionName,
      // but the frontend needs sectionId to render the inline preview
      // + compute `currentSection`. Fallback to null if not found.
      sectionId: resolveSectionIdForSubject(docSections, p.subjectId) ?? null,
      suggestedNewSectionName: null,
      subjectAction: 'update-existing-subject',
      targetSubjectId: p.subjectId ?? null,
      updatedSituation: p.appendText ?? null,
      updatedStatus: null,
      updatedResponsibility: null,
    }];
  }

  if (p.action === 'create_subject') {
    return [{
      ...baseReview,
      title: p.title ?? '',
      situation: p.situation ?? '',
      status: p.status ?? 'en-cours',
      responsibility: p.responsibility ?? null,
      sectionAction: 'existing-section',
      sectionId: p.sectionId ?? null,
      suggestedNewSectionName: null,
      subjectAction: 'new-subject',
      targetSubjectId: null,
      updatedSituation: null,
      updatedStatus: null,
      updatedResponsibility: null,
    }];
  }

  // create_section — fan out one entry per subject in the new section.
  const subjects = p.subjects ?? [];
  if (subjects.length === 0) return [];
  return subjects.map(sub => ({
    ...baseReview,
    title: sub.title,
    situation: sub.situation,
    status: sub.status,
    responsibility: sub.responsibility,
    sectionAction: 'new-section' as const,
    sectionId: null,
    suggestedNewSectionName: p.sectionName ?? 'Nouvelle section',
    subjectAction: 'new-subject' as const,
    targetSubjectId: null,
    updatedSituation: null,
    updatedStatus: null,
    updatedResponsibility: null,
  }));
}

/**
 * Group Slack messages by (channel + day) into digest items.
 * Each digest aggregates all messages from one channel on one calendar day
 * so the AI analyses a full conversation context, not individual messages.
 * The `id` is `slack:channelId:YYYY-MM-DD` and stays stable for dedup.
 */
function groupSlackMessagesByDay(
  messages: Array<{
    channelId: string;
    channelName: string | null;
    messageTs: string;
    senderName: string | null;
    text: string;
  }>,
): Array<{
  id: string;
  provider: 'slack';
  title: string;
  date: string;
  preview: string;
  participants: string[];
}> {
  const groups = new Map<string, typeof messages>();

  for (const m of messages) {
    const dateStr = new Date(parseFloat(m.messageTs) * 1000)
      .toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${m.channelId}:${dateStr}`;
    const group = groups.get(key) || [];
    group.push(m);
    groups.set(key, group);
  }

  const items: Array<{
    id: string;
    provider: 'slack';
    title: string;
    date: string;
    preview: string;
    participants: string[];
  }> = [];

  for (const [key, msgs] of groups) {
    const [channelId, dateStr] = key.split(':');
    const channelName = msgs[0]?.channelName || channelId;
    const participants = [...new Set(msgs.map(m => m.senderName).filter(Boolean) as string[])];

    // Build a readable date label
    const dateLabel = new Date(dateStr + 'T00:00:00')
      .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Sort messages chronologically and build a preview
    const sorted = msgs.sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs));
    const preview = sorted
      .slice(0, 5)
      .map(m => `[${m.senderName || '?'}] ${m.text.slice(0, 80)}`)
      .join('\n');

    items.push({
      id: `slack:${channelId}:${dateStr}`,
      provider: 'slack',
      // Title explicitly says 'Messages du …' so the user doesn't confuse
      // the date in the title (= date of the collected messages) with the
      // sync time shown in the banner at the top of the modal.
      title: `#${channelName} — Messages du ${dateLabel} (${msgs.length} messages)`,
      date: dateStr + 'T12:00:00.000Z',
      preview,
      participants,
    });
  }

  // Sort by date desc
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

export function createRoutes(): Router {
  const router = Router();

  router.use(authMiddleware);

  // ==================== REPLAY — rejouer un import depuis les logs ====================
  //
  // Rebuild the exact pipeline response shape from the stored logs (T2
  // placement + T3 writers). Zero LLM calls — ~100ms instead of 2-3 min.
  // Use-case : iterate on the frontend UX without paying / waiting for
  // the full pipeline.

  // GET /transcription/replay/recent — list recent replayable runs
  router.get('/transcription/replay/recent', asyncHandler(async (req, res) => {
    const { listReplayableRuns } = await import('./replayService.js');
    const runs = await listReplayableRuns(req.user!.id, 20);
    res.json({ runs });
  }));

  // POST /transcription/replay/:t2LogId — reconstruct the result
  router.post('/transcription/replay/:t2LogId', asyncHandler(async (req, res) => {
    const { replayFromT2Log } = await import('./replayService.js');
    const t2LogId = parseInt(req.params.t2LogId, 10);
    if (Number.isNaN(t2LogId)) { res.status(400).json({ error: 'ID invalide' }); return; }

    const result = await replayFromT2Log(t2LogId, req.user!.id);
    if (!result) { res.status(404).json({ error: 'Log introuvable ou non autorisé' }); return; }

    // Fresh snapshot of the reviews — the logged state might be stale.
    const { analyzeMultiSourceForReviews: _unused } = await import('../aiSkills/analyzeSourcePipeline.js');
    void _unused;
    const existingDocs = await db.getAllDocuments(req.user!.id, req.user!.isAdmin);
    const reviewsSnap: Array<{
      id: string; title: string;
      sections: Array<{ id: string; name: string; subjects: Array<{ id: string; title: string; status: string | null }> }>;
    }> = [];
    for (const d of existingDocs.slice(0, 40)) {
      try {
        const doc = await db.getDocumentWithSections(d.id);
        if (!doc) continue;
        reviewsSnap.push({
          id: doc.id,
          title: doc.title,
          sections: (doc.sections || []).map(s => ({
            id: s.id,
            name: s.name,
            subjects: (s.subjects || []).map(sub => ({ id: sub.id, title: sub.title, status: sub.status ?? null, situation: sub.situation ?? null })),
          })),
        });
      } catch { /* best effort */ }
    }

    res.json({
      summary: result.summary,
      subjects: result.subjects,
      availableReviews: reviewsSnap,
      logId: result.logId,
      replayedFromLogId: result.replayedFromLogId,
    });
  }));

  // ==================== ROUTING MEMORY — admin inspection ====================
  //
  // Per-user pgvector memory of past (subject → review/section) decisions,
  // used to make the place-in-reviews skill more accurate over time via
  // in-context few-shot examples. These endpoints let the user inspect
  // what's been learned and delete entries that are pushing the skill in
  // the wrong direction.

  // GET /routing-memory — last 50 decisions of the current user
  router.get('/routing-memory', asyncHandler(async (req, res) => {
    const { listRecentMemory } = await import('./routingMemoryService.js');
    const rows = await listRecentMemory(req.user!.id, 50);
    res.json({ rows });
  }));

  // DELETE /routing-memory/:id — forget one specific decision
  router.delete('/routing-memory/:id', asyncHandler(async (req, res) => {
    const { deleteMemory } = await import('./routingMemoryService.js');
    const ok = await deleteMemory(req.user!.id, req.params.id);
    if (!ok) { res.status(404).json({ error: 'Mémoire introuvable' }); return; }
    res.status(204).send();
  }));

  // ==================== ADMIN — LEGACY BULLET CLEANUP ====================
  //
  // One-shot migration endpoint : the AI writer skills used to insert
  // literal `•` characters into `situation` texts, which the editor
  // then double-rendered (`• •`). The writers have been fixed since
  // (see `src/prompts/suivitess/{compose,append}-situation.md`) but
  // existing DB rows still carry legacy bullets. This endpoint runs a
  // deterministic text transformation (strip leading bullet glyphs,
  // normalize tabs to 2 spaces) across every subject and returns a
  // diff (dry-run mode) or applies it in a single transaction.
  //
  // Admin-gated — dry-runs are also admin-only because the preview
  // reveals every situation text across the platform.

  router.post('/admin/cleanup-legacy-bullets', asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin uniquement' });
      return;
    }
    const apply = Boolean((req.body ?? {}).apply);
    const { cleanSituation, situationNeedsCleaning } = await import('./legacyBulletCleanup.js');
    const { pool } = await import('./dbService.js');

    // Fetch every subject + its owning section/document for context in
    // the diff. Capped at 5000 rows as a safety net — if the platform
    // ever gets bigger, we'd paginate ; for current scale this fits in
    // memory easily.
    const result = await pool.query<{
      id: string; title: string; situation: string | null;
      section_name: string; document_title: string; document_id: string;
    }>(`
      SELECT s.id, s.title, s.situation,
             sec.name AS section_name,
             d.id AS document_id, d.title AS document_title
      FROM suivitess_subjects s
      JOIN suivitess_sections sec ON sec.id = s.section_id
      JOIN suivitess_documents d  ON d.id  = sec.document_id
      ORDER BY d.title, sec.position, s.position
      LIMIT 5000
    `);

    const dirty = result.rows
      .filter(r => situationNeedsCleaning(r.situation))
      .map(r => ({
        id: r.id,
        title: r.title,
        documentId: r.document_id,
        documentTitle: r.document_title,
        sectionName: r.section_name,
        before: r.situation ?? '',
        after: cleanSituation(r.situation),
      }));

    if (!apply) {
      res.json({
        mode: 'dry-run',
        totalScanned: result.rows.length,
        rowsToClean: dirty.length,
        rows: dirty.slice(0, 500), // preview cap
        truncated: dirty.length > 500,
      });
      return;
    }

    // ── Apply in a single transaction ──
    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const row of dirty) {
        await client.query(
          'UPDATE suivitess_subjects SET situation = $1, updated_at = NOW() WHERE id = $2',
          [row.after, row.id],
        );
        updated++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      mode: 'applied',
      totalScanned: result.rows.length,
      rowsUpdated: updated,
    });
  }));

  // ==================== SUBJECT SEARCH (cross-document) ====================

  // GET /subjects/search?q=<query>
  router.get('/subjects/search', asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const results = await db.searchSubjects(q);
    res.json(results);
  }));

  // ==================== DOCUMENTS ====================

  // List all documents
  router.get('/documents', asyncHandler(async (req, res) => {
    const docs = await db.getAllDocuments(req.user!.id, req.user!.isAdmin);
    res.json(docs);
  }));

  // Create document
  router.post('/documents', asyncHandler(async (req, res) => {
    const { title, description, visibility } = req.body;
    const vis = visibility === 'public' ? 'public' : 'private';

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    // Credit check
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'create_document'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    // Generate base slug from title (kebab-case). Documents may share the same
    // name — we keep a readable slug in the URL by appending -2, -3, ... when
    // the base slug collides with an existing primary key.
    const baseSlug = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'document';

    const MAX_SUFFIX_ATTEMPTS = 100;
    let id = baseSlug;
    let suffix = 1;

    for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
      try {
        const doc = await db.createDocument(id, title.trim(), description?.trim() || null);
        console.log('[SuiVitess] Document created:', id);
        // Create sharing entry (private by default)
        try {
          const { ensureOwnership } = await import('../shared/resourceSharing.js');
          await ensureOwnership('suivitess', doc.id, req.user!.id, vis);
        } catch { /* ignore */ }
        res.json(doc);
        return;
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          // Primary-key collision → try next suffix
          suffix += 1;
          id = `${baseSlug}-${suffix}`;
          continue;
        }
        throw error;
      }
    }

    // Should be unreachable in practice
    res.status(500).json({ error: 'Impossible de générer un identifiant unique pour ce document' });
  }));

  // Update document title/description
  router.put('/documents/:docId', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { title, description } = req.body;
    if (title !== undefined && !String(title).trim()) {
      res.status(400).json({ error: 'Le titre est obligatoire' });
      return;
    }
    const updated = await db.updateDocument(docId, {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(description !== undefined ? { description: String(description).trim() || null } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(updated);
  }));

  // Get document with all sections and subjects
  router.get('/documents/:docId', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const doc = await db.getDocumentWithSections(docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(doc);
  }));

  // Delete document
  router.delete('/documents/:docId', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const count = await db.deleteDocument(docId);
    if (count === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    console.log('[SuiVitess] Document deleted:', docId);
    res.json({ success: true });
  }));

  // ==================== SECTIONS ====================

  // Add section to document
  router.post('/documents/:docId/sections', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Section name is required' });
      return;
    }

    const section = await db.createSection(docId, name.trim());
    console.log('[SuiVitess] Section created:', section.id);
    res.json(section);
  }));

  // Update section (rename or change position)
  router.put('/sections/:sectionId', asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { name, position } = req.body;

    const section = await db.getSection(sectionId);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    if (name !== undefined) {
      await db.updateSectionName(sectionId, name.trim());
    }

    if (position !== undefined && position !== section.position) {
      await db.updateSectionPosition(section.document_id, sectionId, section.position, position);
    }

    await db.updateDocumentTimestamp(section.document_id);

    const updated = await db.getSection(sectionId);
    res.json(updated);
  }));

  // Delete section
  router.delete('/sections/:sectionId', asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const result = await db.deleteSection(sectionId);
    if (!result) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }
    console.log('[SuiVitess] Section deleted:', sectionId, '(', result.deletedSubjects, 'subjects)');
    res.json({ success: true, deletedSubjects: result.deletedSubjects });
  }));

  // Reorder all sections
  router.post('/documents/:docId/sections/reorder', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { sectionIds } = req.body;

    if (!Array.isArray(sectionIds)) {
      res.status(400).json({ error: 'sectionIds array is required' });
      return;
    }

    await db.reorderSections(docId, sectionIds);
    res.json({ success: true });
  }));

  // ==================== SUBJECTS ====================

  // Add subject to section
  router.post('/sections/:sectionId/subjects', asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { title, situation, status, responsibility } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Subject title is required' });
      return;
    }

    const docId = await db.getSectionDocId(sectionId);
    if (!docId) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    const subject = await db.createSubject(
      sectionId,
      title.trim(),
      situation || null,
      status || '🔴 à faire',
      responsibility || null
    );

    console.log('[SuiVitess] Subject created:', subject.id);
    res.json(subject);
  }));

  // Update subject
  router.put('/subjects/:subjectId', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const { title, situation, status, responsibility, sectionId, position } = req.body;

    const subject = await db.getSubjectWithDocId(subjectId);
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const docId = subject.document_id;

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title.trim());
    }
    if (situation !== undefined) {
      updates.push(`situation = $${paramCount++}`);
      values.push(situation);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (responsibility !== undefined) {
      updates.push(`responsibility = $${paramCount++}`);
      values.push(responsibility);
    }

    // Handle section change (move to different section)
    if (sectionId !== undefined && sectionId !== subject.section_id) {
      const isValid = await db.verifyTargetSection(sectionId, docId);
      if (!isValid) {
        res.status(400).json({ error: 'Target section not found or belongs to different document' });
        return;
      }

      const newPos = position !== undefined ? position : await db.getNextSubjectPosition(sectionId);

      await db.moveSubjectToSection(subjectId, subject.section_id, subject.position, sectionId, newPos);

      updates.push(`section_id = $${paramCount++}`);
      values.push(sectionId);
      updates.push(`position = $${paramCount++}`);
      values.push(newPos);
    } else if (position !== undefined && position !== subject.position) {
      await db.reorderSubjectPositions(subject.section_id, subject.position, position);
      updates.push(`position = $${paramCount++}`);
      values.push(position);
    }

    if (updates.length > 0) {
      await db.updateSubjectFields(subjectId, updates, values);
    }

    await db.updateDocumentTimestamp(docId);

    const updated = await db.getSubject(subjectId);
    res.json(updated);
  }));

  // Reformulate a subject's situation using AI
  router.post('/subjects/:subjectId/reformulate', asyncHandler(async (req, res) => {
    const subject = await db.getSubject(req.params.subjectId);
    if (!subject) { res.status(404).json({ error: 'Sujet non trouvé' }); return; }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'reformulation'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    const inputSummary = `Titre : ${subject.title}
État de la situation : ${subject.situation || '(vide)'}
Responsable : ${subject.responsibility || 'Non assigné'}
Statut : ${subject.status}`;

    const { runSkill } = await import('../aiSkills/runSkill.js');
    const runRes = await runSkill({
      slug: 'suivitess-reformulate-subject',
      userId: req.user!.id,
      userEmail: req.user!.email,
      buildPrompt: (skill) => `${skill}\n\n---\n\n# Sujet à reformuler\n\n${inputSummary}\n\nApplique les règles ci-dessus et réponds uniquement en JSON.`,
      inputContent: inputSummary,
      sourceKind: 'subject',
      sourceTitle: subject.title,
      documentId: null,
      maxTokens: 2000,
    });

    let result: { title?: string; situation?: string } = {};
    try {
      let json = runRes.outputText.trim();
      if (json.startsWith('```json')) json = json.slice(7);
      if (json.startsWith('```')) json = json.slice(3);
      if (json.endsWith('```')) json = json.slice(0, -3);
      result = JSON.parse(json.trim());
    } catch {
      const match = runRes.outputText.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    }

    const finalTitle = result.title || subject.title;
    const finalSituation = result.situation || subject.situation;
    if (runRes.logId != null) {
      const { attachProposalsToLog } = await import('../aiSkills/analysisLogsService.js');
      await attachProposalsToLog(runRes.logId, [{ title: finalTitle, situation: finalSituation }]);
    }
    res.json({ title: finalTitle, situation: finalSituation, logId: runRes.logId });
  }));

  // Generate an email summary for one or all subjects
  router.post('/email-summary', asyncHandler(async (req, res) => {
    const { documentId, subjectId, template } = req.body as {
      documentId?: string;
      subjectId?: string; // optional — if set, only this subject
      template: 'listing' | 'situation-cible' | 'actions' | 'executive';
    };

    if (!documentId) { res.status(400).json({ error: 'documentId requis' }); return; }

    const doc = await db.getDocumentWithSections(documentId);
    if (!doc) { res.status(404).json({ error: 'Document non trouvé' }); return; }

    // Build content — single subject or full document
    let content = '';
    if (subjectId) {
      for (const s of doc.sections) {
        const sub = s.subjects.find(sub => sub.id === subjectId);
        if (sub) {
          content = `Section : ${s.name}\nSujet : ${sub.title}\nStatut : ${sub.status}\nResponsable : ${sub.responsibility || '-'}\nSituation :\n${sub.situation || '(vide)'}`;
          break;
        }
      }
    } else {
      content = doc.sections.map(s => {
        const subs = s.subjects.map(sub =>
          `  - [${sub.status}] ${sub.title} (resp: ${sub.responsibility || '-'})\n    ${sub.situation || '(vide)'}`
        ).join('\n');
        return `Section "${s.name}" :\n${subs}`;
      }).join('\n\n');
    }

    const templatePrompts: Record<string, string> = {
      'listing': `Génère un email de récap sous forme de listing clair et concis. Chaque point = 1 ligne avec un bullet. Regroupe par section. Ton professionnel mais direct.`,
      'situation-cible': `Génère un email structuré en 2 parties par sujet :
- **Situation actuelle** : ce qui est en place aujourd'hui
- **Situation cible** : ce qu'on vise
Ton professionnel.`,
      'actions': `Génère un email orienté actions. Pour chaque sujet, liste :
- L'action à réaliser
- Le responsable
- La deadline estimée (si mentionnée)
Format tableau ou liste numérotée. Ton direct et actionnable.`,
      'executive': `Génère un résumé exécutif de 5-10 lignes max. Synthétise les points clés, les risques et les prochaines étapes. Ton senior management — concis, stratégique, pas de détails opérationnels.`,
    };

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'email_generation'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const fullPrompt = `${templatePrompts[template] || templatePrompts.listing}

Document : "${doc.title}"
${content}

Retourne UNIQUEMENT le corps de l'email (pas d'objet, pas de signature). En français.`;

    // ── Best-effort logging : capture latency, tokens, cost and output.
    //    Logged in both success and failure paths so /ai-logs stays
    //    complete even when the AI call itself throws. ──
    const { logAnalysis } = await import('../aiSkills/analysisLogsService.js');
    const startedAt = Date.now();
    let aiResponse: Awaited<ReturnType<typeof client.messages.create>> | null = null;
    let emailBody = '';
    let logError: string | null = null;
    try {
      aiResponse = await client.messages.create({
        model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: fullPrompt }],
      });
      emailBody = aiResponse.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('');
    } catch (e) {
      logError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const usage = aiResponse && 'usage' in aiResponse ? aiResponse.usage as { input_tokens?: number; output_tokens?: number } | undefined : undefined;
      await logAnalysis({
        userId: req.user!.id,
        userEmail: req.user!.email,
        skillSlug: 'suivitess-email-summary',
        sourceKind: 'email-summary',
        sourceTitle: `${template} — ${doc.title}`,
        documentId: String(documentId),
        inputContent: content,
        fullPrompt,
        aiOutputRaw: emailBody,
        proposals: null,
        durationMs: Date.now() - startedAt,
        error: logError,
        provider: 'anthropic',
        model,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
      });
    }

    res.json({ email: emailBody, template });
  }));

  // Delete subject
  router.delete('/subjects/:subjectId', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const result = await db.deleteSubject(subjectId);
    if (!result) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }
    console.log('[SuiVitess] Subject deleted:', subjectId);
    res.json({ success: true });
  }));

  // Reorder subjects within a section
  router.post('/sections/:sectionId/subjects/reorder', asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { subjectIds } = req.body;

    if (!Array.isArray(subjectIds)) {
      res.status(400).json({ error: 'subjectIds array is required' });
      return;
    }

    const result = await db.reorderSubjects(sectionId, subjectIds);
    if (!result) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }
    res.json({ success: true });
  }));

  // ==================== SNAPSHOTS ====================

  // Create snapshot
  router.post('/documents/:docId/snapshots', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const doc = await db.getDocumentWithSections(docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await db.createSnapshotForDocument(docId);
    console.log('[SuiVitess] Snapshot created for:', docId);
    res.json({ success: true });
  }));

  // Get snapshot history
  router.get('/documents/:docId/snapshots', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const snapshots = await db.getSnapshotHistory(docId);
    res.json(snapshots);
  }));

  // Get specific snapshot
  router.get('/snapshots/:snapshotId', asyncHandler(async (req, res) => {
    const { snapshotId } = req.params;
    const snapshot = await db.getSnapshot(parseInt(snapshotId));
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }
    res.json({
      ...snapshot,
      data: snapshot.snapshot_data || null,
    });
  }));

  // Restore from snapshot
  router.post('/snapshots/:snapshotId/restore', asyncHandler(async (req, res) => {
    const { snapshotId } = req.params;
    const snapshot = await db.getSnapshot(parseInt(snapshotId));
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const data = snapshot.snapshot_data as DocumentWithSections | null;
    const docId = snapshot.document_id;

    if (!data || !data.sections) {
      res.status(400).json({ error: 'Cannot restore from legacy snapshot (no structured data)' });
      return;
    }

    await db.restoreFromSnapshot(docId, data);
    console.log('[SuiVitess] Document restored from snapshot:', snapshotId);
    res.json({ success: true });
  }));

  // Get diff between current and latest snapshot
  router.get('/documents/:docId/diff', asyncHandler(async (req, res) => {
    const { docId } = req.params;

    const currentDoc = await db.getDocumentWithSections(docId);
    if (!currentDoc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const latestSnapshot = await db.getLatestSnapshot(docId);

    if (!latestSnapshot) {
      res.json({ hasChanges: false, snapshotDate: null, changes: [] });
      return;
    }

    const snapshotData = latestSnapshot.snapshot_data as DocumentWithSections | null;
    const snapshotDate = latestSnapshot.created_at;

    if (!snapshotData || !snapshotData.sections) {
      res.json({ hasChanges: false, snapshotDate, changes: [] });
      return;
    }

    // Build maps for comparison
    const snapshotSubjects = new Map<string, { subject: { id: string; title: string; situation: string | null; status: string; responsibility: string | null }; sectionName: string }>();
    for (const section of snapshotData.sections) {
      for (const subject of section.subjects) {
        snapshotSubjects.set(subject.id, { subject, sectionName: section.name });
      }
    }

    const currentSubjects = new Map<string, boolean>();
    const changes: Array<{
      sectionName: string;
      subjectTitle: string;
      changeType: string;
      details: string;
      currentStatus?: string;
    }> = [];

    for (const section of currentDoc.sections) {
      for (const subject of section.subjects) {
        currentSubjects.set(subject.id, true);
        const snap = snapshotSubjects.get(subject.id);

        if (!snap) {
          changes.push({
            sectionName: section.name,
            subjectTitle: subject.title,
            changeType: 'added',
            details: 'Nouveau sujet ajouté',
          });
          continue;
        }

        if (snap.subject.status !== subject.status) {
          changes.push({
            sectionName: section.name,
            subjectTitle: subject.title,
            changeType: 'status_changed',
            details: `Statut: ${snap.subject.status} → ${subject.status}`,
          });
        }
        if (snap.subject.responsibility !== subject.responsibility) {
          changes.push({
            sectionName: section.name,
            subjectTitle: subject.title,
            changeType: 'responsibility_changed',
            details: `Responsabilité: ${snap.subject.responsibility || '(vide)'} → ${subject.responsibility || '(vide)'}`,
          });
        }
        if (snap.subject.situation !== subject.situation) {
          changes.push({
            sectionName: section.name,
            subjectTitle: subject.title,
            changeType: 'content_changed',
            details: 'Situation modifiée',
            currentStatus: subject.status,
          });
        }
        if (snap.subject.title !== subject.title) {
          changes.push({
            sectionName: section.name,
            subjectTitle: subject.title,
            changeType: 'title_changed',
            details: `Titre: ${snap.subject.title} → ${subject.title}`,
          });
        }
      }
    }

    for (const [subjectId, { subject, sectionName }] of snapshotSubjects) {
      if (!currentSubjects.has(subjectId)) {
        changes.push({
          sectionName,
          subjectTitle: subject.title,
          changeType: 'removed',
          details: 'Sujet supprimé',
        });
      }
    }

    res.json({
      hasChanges: changes.length > 0,
      snapshotDate,
      changesCount: changes.length,
      changes,
    });
  }));

  // ==================== RECORDER ====================

  // POST /documents/:docId/recorder/start
  router.post('/documents/:docId/recorder/start', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { meetingUrl } = req.body;

    if (!meetingUrl || typeof meetingUrl !== 'string') {
      res.status(400).json({ error: 'meetingUrl est requis' });
      return;
    }

    // Basic Teams URL validation
    const teamsUrlPattern = /teams\.microsoft\.com|teams\.live\.com/i;
    if (!teamsUrlPattern.test(meetingUrl)) {
      res.status(400).json({ error: 'URL invalide — doit être un lien Microsoft Teams' });
      return;
    }

    const doc = await db.getDocumentWithSections(docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    try {
      const recordingId = await recorder.startRecording(docId, meetingUrl);
      res.json({ recordingId, status: 'joining' });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // GET /documents/:docId/recorder/status
  router.get('/documents/:docId/recorder/status', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const recording = await db.getRecordingByDocument(docId);
    const active = recorder.getActiveRecordingStatus(docId);

    if (!recording) {
      res.json({ recordingId: null, status: 'idle', captionCount: 0, startedAt: null, error: null });
      return;
    }

    res.json({
      recordingId: recording.id,
      status: recording.status,
      captionCount: active?.captionCount ?? recording.captionCount,
      startedAt: recording.startedAt,
      error: recording.error,
    });
  }));

  // POST /documents/:docId/recorder/stop
  router.post('/documents/:docId/recorder/stop', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    await recorder.stopRecording(docId);
    res.json({ success: true });
  }));

  // GET /documents/:docId/suggestions
  router.get('/documents/:docId/suggestions', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const suggestions = await db.getSuggestions(docId);
    res.json(suggestions);
  }));

  // POST /suggestions/:id/accept
  router.post('/suggestions/:id/accept', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid suggestion id' }); return; }

    const suggestion = await db.updateSuggestionStatus(id, 'accepted');
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }

    await acceptSuggestion(suggestion, suggestion.documentId);
    res.json({ success: true });
  }));

  // POST /suggestions/:id/reject
  router.post('/suggestions/:id/reject', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid suggestion id' }); return; }

    const suggestion = await db.updateSuggestionStatus(id, 'rejected');
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }

    res.json({ success: true });
  }));

  // ==================== Transcript Import Tracking ====================
  // Track which calls have been imported to prevent duplicates.
  // Auto-created table at route registration time (idempotent).
  (async () => {
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS suivitess_transcript_imports (
          id SERIAL PRIMARY KEY,
          document_id VARCHAR(50) NOT NULL,
          call_id VARCHAR(100) NOT NULL,
          provider VARCHAR(20) NOT NULL,
          call_title TEXT,
          imported_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(document_id, call_id, provider)
        )
      `);
    } catch { /* already exists */ }
  })();

  // ==================== Transcription Import (Fathom, Otter, etc.) ====================
  // NOTE: the legacy per-call import endpoints (transcript-imports,
  // transcript-import, transcript-propose, transcript-analyze-and-propose,
  // email/list, email/body, transcription/calls) were removed — they
  // were consumed only by the retired TranscriptionWizard. The current
  // flow uses the global BulkTranscriptionImportModal + the
  // /documents/:docId/bulk-analyze async job. The Chrome extension
  // still uses /content-analyze-and-propose + /content-import +
  // /transcript-apply (defined further down in this file).

  // Import a call transcript into a SuiviTess document section.
  // Provider-agnostic — fetches transcript from the configured provider,
  // then creates a section + subjects in the target document.

  // ── Step 1: AI proposes changes (preview, nothing applied yet) ──

  // ── Step 2: Apply selected proposals ──
  router.post('/documents/:docId/transcript-apply', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { proposals } = req.body as {
      proposals: Array<{
        action: 'enrich' | 'create_subject' | 'create_section';
        subjectId?: string;
        appendText?: string;
        sectionId?: string;
        sectionName?: string;
        title?: string;
        situation?: string;
        responsibility?: string | null;
        status?: string;
        subjects?: Array<{ title: string; situation: string; responsibility?: string | null; status?: string }>;
      }>;
    };

    if (!proposals || proposals.length === 0) {
      res.json({ success: true, applied: 0 });
      return;
    }

    // Auto-snapshot BEFORE applying AI changes so the user can revert.
    try {
      await db.createSnapshotForDocument(docId, 'ai_import');
    } catch { /* non-blocking */ }

    let enriched = 0;
    let created = 0;
    let sectionsCreated = 0;

    for (const p of proposals) {
      if (p.action === 'enrich' && p.subjectId && p.appendText) {
        // Fetch current situation, append new text
        const doc = await db.getDocumentWithSections(docId);
        if (!doc) continue;
        let currentSituation = '';
        for (const s of doc.sections) {
          const sub = s.subjects.find(sub => sub.id === p.subjectId);
          if (sub) { currentSituation = sub.situation || ''; break; }
        }
        const newSituation = currentSituation
          ? `${currentSituation}\n\n---\n📝 Ajouté depuis transcription :\n${p.appendText}`
          : p.appendText;
        await db.updateSubjectFields(p.subjectId, ['situation = $1'], [newSituation]);
        enriched++;

      } else if (p.action === 'create_subject' && p.sectionId && p.title) {
        await db.createSubject(
          p.sectionId,
          p.title,
          p.situation || '',
          p.status || '🔴 à faire',
          p.responsibility || null,
        );
        created++;

      } else if (p.action === 'create_section' && p.sectionName) {
        const section = await db.createSection(docId, p.sectionName);
        sectionsCreated++;
        if (p.subjects) {
          for (const sub of p.subjects) {
            await db.createSubject(
              section.id,
              sub.title,
              sub.situation || '',
              sub.status || '🔴 à faire',
              sub.responsibility || null,
            );
            created++;
          }
        }
      }
    }

    res.json({
      success: true,
      enriched,
      created,
      sectionsCreated,
      applied: enriched + created + sectionsCreated,
    });
  }));

  // ── Direct transcript analysis: fetch transcript + analyze against document in one step ──
  // No intermediate section created. Used by the unified TranscriptionWizard "Analyser et fusionner" mode.

  // ── Streaming version of the analysis (SSE) ──
  // Streams the AI's narrated journal in real time ; emits the final
  // proposals once done. Same input shape as transcript-analyze-and-propose
  // but accepts transcript/email/slack via `sourceKind`.
  router.post('/documents/:docId/analyze-source-stream', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { sourceKind, sourceTitle, content, callId, provider } = req.body as {
      sourceKind: 'transcript' | 'outlook' | 'gmail' | 'slack';
      sourceTitle?: string;
      content?: string;
      callId?: string;
      provider?: 'fathom' | 'otter';
    };

    const doc = await db.getDocumentWithSections(String(docId));
    if (!doc) { res.status(404).json({ error: 'Document non trouvé' }); return; }

    // If sourceKind === 'transcript', caller gives us (callId + provider) and
    // we fetch the transcript ourselves. Otherwise content is passed in.
    let body = content ?? '';
    if (sourceKind === 'transcript') {
      if (!callId || !provider) { res.status(400).json({ error: 'callId + provider requis' }); return; }
      const transcript = provider === 'fathom'
        ? await (await import('./fathomService.js')).getFathomTranscript(req.user!.id, callId)
        : await (await import('./otterService.js')).getOtterTranscript(req.user!.id, callId);
      if (!transcript || transcript.length === 0) { res.status(400).json({ error: 'Transcription vide' }); return; }
      body = transcript.map((e: { speaker: string; text: string }) => `[${e.speaker}]: ${e.text}`).join('\n');
    }
    if (!body.trim()) { res.status(400).json({ error: 'Contenu vide' }); return; }

    // Credits — same quota as the non-streamed endpoint.
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try {
      await deductCredits(
        req.user!.id, req.user!.isAdmin, 'suivitess',
        sourceKind === 'transcript' ? 'transcript_analysis' : 'content_analysis',
      );
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        res.status(402).json({ error: 'INSUFFICIENT_CREDITS', required: e.required, available: e.available });
        return;
      }
      throw e;
    }

    const { streamAnalysis } = await import('./streamingAnalysisService.js');
    await streamAnalysis(res, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      doc,
      sourceKind,
      sourceTitle: sourceTitle || 'Source',
      content: body,
    });
  }));

  // ==================== CONTENT IMPORT (Email/Slack via Chrome extension) ====================

  // POST /documents/:docId/content-import
  // Imports raw text content (aggregated emails or Slack messages) into a new section
  router.post('/documents/:docId/content-import', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { content, source, sourceTitle, useAI, itemIds } = req.body as {
      content: string;
      source: 'outlook' | 'slack';
      sourceTitle: string;
      useAI?: boolean;
      itemIds?: string[];
    };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Contenu vide' });
      return;
    }

    const doc = await db.getDocumentWithSections(docId);
    if (!doc) { res.status(404).json({ error: 'Document non trouve' }); return; }

    // Dedup: check which items have already been imported
    let skipped = 0;
    let filteredContent = content;
    if (itemIds && itemIds.length > 0) {
      const { rows: existing } = await db.pool.query(
        `SELECT call_id FROM suivitess_transcript_imports WHERE document_id = $1 AND provider = $2 AND call_id = ANY($3)`,
        [docId, source, itemIds]
      );
      const existingIds = new Set(existing.map((r: { call_id: string }) => r.call_id));
      skipped = existingIds.size;

      if (skipped === itemIds.length) {
        res.json({ success: true, subjectCount: 0, skipped, mode: useAI ? 'ai' : 'raw', sectionName: '', message: 'Tous les elements ont deja ete importes' });
        return;
      }

      // Filter out already-imported blocks from content
      if (skipped > 0) {
        const blocks = content.split(/(?==== )/);
        const newBlocks: string[] = [];
        let idx = 0;
        for (const block of blocks) {
          if (idx < itemIds.length && existingIds.has(itemIds[idx])) {
            // skip this block
          } else {
            newBlocks.push(block);
          }
          idx++;
        }
        filteredContent = newBlocks.join('');
      }
    }

    const sourceLabel = source === 'outlook' ? 'Outlook' : 'Slack';
    const sectionName = `${sourceLabel} — ${sourceTitle || 'Import'}`;
    const section = await db.createSection(docId, sectionName);

    if (useAI) {
      const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
      try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'content_import'); }
      catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

      try {
        const { getAnthropicClient } = await import('../connectors/aiProvider.js');
        const { client, model } = await getAnthropicClient(req.user!.id);

        const aiResponse = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `Tu es un assistant de suivi de projet. Analyse ce contenu (${source === 'outlook' ? 'emails' : 'messages Slack'}) et extrais les sujets cles discutes.

Pour chaque sujet, fournis :
- title: titre concis du sujet
- situation: resume de la situation/discussion
- responsibility: personne responsable si identifiable (sinon null)
- status: un des statuts suivants: "a faire", "en cours", "fait", "bloque"

Reponds UNIQUEMENT avec un JSON valide : { "subjects": [...] }
Maximum 15 sujets. Ignore les messages trivaux (salutations, remerciements).

Contenu :
${filteredContent.slice(0, 30000)}`,
          }],
        });

        const text = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
        let subjects: Array<{ title: string; situation?: string; responsibility?: string; status?: string }> = [];
        try {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            subjects = parsed.subjects || [];
          }
        } catch { /* parse error — fallback to raw */ }

        let pos = 0;
        for (const sub of subjects) {
          await db.createSubject(section.id, sub.title, sub.situation || null, sub.status || 'a faire', sub.responsibility || null, pos++);
        }

        // Record imported items for dedup
        if (itemIds) {
          const { rows: existing } = await db.pool.query(
            `SELECT call_id FROM suivitess_transcript_imports WHERE document_id = $1 AND provider = $2 AND call_id = ANY($3)`,
            [docId, source, itemIds]
          );
          const existingIds = new Set(existing.map((r: { call_id: string }) => r.call_id));
          for (const id of itemIds) {
            if (!existingIds.has(id)) {
              await db.pool.query(
                `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [docId, id, source, sourceTitle]
              );
            }
          }
        }

        res.json({ success: true, sectionId: section.id, sectionName, subjectCount: subjects.length, skipped, mode: 'ai' });
      } catch (err) {
        console.error('[SuiviTess] AI content analysis failed:', err);
        res.status(500).json({ error: 'Analyse IA echouee' });
      }
    } else {
      // Raw import: split by === delimiter
      const blocks = filteredContent.split(/===\s*/).filter(b => b.trim());
      let pos = 0;
      for (const block of blocks) {
        const lines = block.trim().split('\n');
        const title = lines[0]?.trim().replace(/===\s*$/, '').slice(0, 200) || `Import ${pos + 1}`;
        const situation = lines.slice(1).join('\n').trim();
        if (title || situation) {
          await db.createSubject(section.id, title, situation || null, 'a faire', null, pos++);
        }
      }

      // Record imported items for dedup
      if (itemIds) {
        const { rows: existing } = await db.pool.query(
          `SELECT call_id FROM suivitess_transcript_imports WHERE document_id = $1 AND provider = $2 AND call_id = ANY($3)`,
          [docId, source, itemIds]
        );
        const existingIds = new Set(existing.map((r: { call_id: string }) => r.call_id));
        for (const id of itemIds) {
          if (!existingIds.has(id)) {
            await db.pool.query(
              `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [docId, id, source, sourceTitle]
            );
          }
        }
      }

      res.json({ success: true, sectionId: section.id, sectionName, subjectCount: pos, skipped, mode: 'raw' });
    }
  }));

  // POST /documents/:docId/content-analyze-and-propose
  // AI analyzes content against existing document and proposes merge/create actions
  router.post('/documents/:docId/content-analyze-and-propose', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { content, source, sourceTitle, itemIds } = req.body as {
      content: string;
      source: 'outlook' | 'slack';
      sourceTitle: string;
      itemIds?: string[];
    };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Contenu vide' });
      return;
    }

    const doc = await db.getDocumentWithSections(docId);
    if (!doc) { res.status(404).json({ error: 'Document non trouve' }); return; }

    // Dedup: check which items have already been imported
    let skipped = 0;
    let filteredContent = content;
    if (itemIds && itemIds.length > 0) {
      const { rows: existing } = await db.pool.query(
        `SELECT call_id FROM suivitess_transcript_imports WHERE document_id = $1 AND provider = $2 AND call_id = ANY($3)`,
        [docId, source, itemIds]
      );
      const existingIds = new Set(existing.map((r: { call_id: string }) => r.call_id));
      skipped = existingIds.size;

      if (skipped === itemIds.length) {
        res.json({ proposals: [], skipped, message: 'Tous les elements ont deja ete importes' });
        return;
      }

      // Filter out already-imported blocks
      if (skipped > 0) {
        const blocks = content.split(/(?==== )/);
        const newBlocks: string[] = [];
        let idx = 0;
        for (const block of blocks) {
          if (idx < itemIds.length && existingIds.has(itemIds[idx])) {
            // skip
          } else {
            newBlocks.push(block);
          }
          idx++;
        }
        filteredContent = newBlocks.join('');
      }

      // Record imported items now (before AI analysis)
      for (const id of itemIds) {
        if (!existing.some((r: { call_id: string }) => r.call_id === id)) {
          await db.pool.query(
            `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [docId, id, source, sourceTitle]
          );
        }
      }
    }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'content_analysis'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    const existingContext = doc.sections.map(s => {
      const subjectsText = s.subjects.map(sub =>
        `  - [id:${sub.id}] [${sub.status}] "${sub.title}" (responsable: ${sub.responsibility || '-'})\n    Situation: ${sub.situation || '(vide)'}`
      ).join('\n');
      return `Section [id:${s.id}] "${s.name}":\n${subjectsText || '  (vide)'}`;
    }).join('\n\n');

    const sourceLabel = source === 'outlook' ? 'emails' : 'messages Slack';

    // ── Modular 3-tier pipeline (always active). ──
    const { analyzeSourceForDocument } = await import('../aiSkills/analyzeSourcePipeline.js');
    const documentCtx = {
      id: String(doc.id),
      title: doc.title,
      sections: doc.sections.map(s => ({
        id: String(s.id),
        name: s.name,
        subjects: s.subjects.map(sub => ({
          id: String(sub.id),
          title: sub.title,
          situationExcerpt: (sub.situation || '').slice(0, 2000),
          status: sub.status,
          responsibility: sub.responsibility ?? null,
        })),
      })),
    };
    const pipelineKind = source === 'slack' ? 'slack' : 'outlook';
    const { proposals, rootLogId } = await analyzeSourceForDocument({
      sourceKind: pipelineKind,
      sourceRaw: filteredContent,
      sourceTitle: sourceTitle || 'Import',
      document: documentCtx,
      userId: req.user!.id,
      userEmail: req.user!.email || '',
    });
    // Consistent with sourceLabel kept for future logging/UI ; the pipeline
    // already logs per-tier via analyzeSourcePipeline.
    void sourceLabel;
    const indexed = proposals.map((p, i) => ({ ...p, id: i }));

    res.json({ proposals: indexed, skipped, logId: rootLogId });
  }));

  // ==================== SUBJECT EXTERNAL LINKS (Jira/Notion/Roadmap) ====================

  // GET /subjects/:subjectId/external-links
  router.get('/subjects/:subjectId/external-links', asyncHandler(async (req, res) => {
    const links = await db.getSubjectLinks(req.params.subjectId);
    res.json(links);
  }));

  // DELETE /subjects/:subjectId/external-links/:linkId
  router.delete('/subjects/:subjectId/external-links/:linkId', asyncHandler(async (req, res) => {
    const linkId = parseInt(req.params.linkId);
    const ok = await db.deleteSubjectLink(linkId);
    if (!ok) { res.status(404).json({ error: 'Lien non trouve' }); return; }
    res.json({ success: true });
  }));

  // GET /jira/createmeta?projectKey=X&issueType=Task
  // Returns required + creatable fields for a project + issue type, with allowed values
  router.get('/jira/createmeta', asyncHandler(async (req, res) => {
    const projectKey = String(req.query.projectKey || '');
    const issueType = String(req.query.issueType || '');
    if (!projectKey || !issueType) { res.status(400).json({ error: 'projectKey et issueType requis' }); return; }

    const { getJiraContext } = await import('../jiraAuth.js');
    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) { res.status(400).json({ error: 'Jira non connecte' }); return; }

    try {
      // Step 1: get the issuetype id for this project + name
      const projRes = await fetch(`${ctx.baseUrl}/rest/api/3/project/${projectKey}`, { headers: ctx.headers });
      if (!projRes.ok) { res.status(400).json({ error: `Projet introuvable: ${projectKey}` }); return; }
      const project = await projRes.json() as { issueTypes?: Array<{ id: string; name: string }> };
      const it = project.issueTypes?.find(t => t.name.toLowerCase() === issueType.toLowerCase());
      if (!it) { res.status(400).json({ error: `Type "${issueType}" non disponible pour ${projectKey}` }); return; }

      // Step 2: get fields for this project + issuetype
      const metaRes = await fetch(
        `${ctx.baseUrl}/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${it.id}?maxResults=200`,
        { headers: ctx.headers }
      );
      if (!metaRes.ok) {
        // Fallback: legacy createmeta endpoint
        const legacyRes = await fetch(
          `${ctx.baseUrl}/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${it.id}&expand=projects.issuetypes.fields`,
          { headers: ctx.headers }
        );
        if (!legacyRes.ok) { res.status(400).json({ error: 'Impossible de recuperer les metadonnees' }); return; }
        const legacy = await legacyRes.json() as {
          projects: Array<{ issuetypes: Array<{ fields: Record<string, { name?: string; required: boolean; schema?: { type: string; items?: string }; allowedValues?: Array<{ id: string; name?: string; value?: string }> }> }> }>;
        };
        const fields = legacy.projects?.[0]?.issuetypes?.[0]?.fields || {};
        res.json({ fields: serializeFields(fields) });
        return;
      }
      const meta = await metaRes.json() as {
        fields: Array<{ fieldId: string; name: string; required: boolean; schema?: { type: string; items?: string }; allowedValues?: Array<{ id: string; name?: string; value?: string }> }>;
      };
      // Convert array form to object form for unified handling
      const obj: Record<string, { name?: string; required: boolean; schema?: { type: string; items?: string }; allowedValues?: Array<{ id: string; name?: string; value?: string }> }> = {};
      for (const f of meta.fields || []) {
        obj[f.fieldId] = { name: f.name, required: f.required, schema: f.schema, allowedValues: f.allowedValues };
      }
      res.json({ fields: serializeFields(obj) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Erreur createmeta' });
    }
  }));

  // POST /subjects/:subjectId/create-jira-ticket
  router.post('/subjects/:subjectId/create-jira-ticket', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const { projectKey, sprintId, issueType, summary, description, storyPoints, customFields } = req.body as {
      projectKey: string;
      sprintId?: string;
      issueType: string;
      summary: string;
      description?: string;
      storyPoints?: number;
      customFields?: Record<string, unknown>;
    };

    if (!projectKey || !summary || !issueType) {
      res.status(400).json({ error: 'projectKey, summary et issueType requis' });
      return;
    }

    // Credit check
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'create_ticket'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    // Get Jira context
    const { getJiraContext } = await import('../jiraAuth.js');
    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) { res.status(400).json({ error: 'Jira non connecte' }); return; }

    // Build Jira issue payload (description as ADF)
    const descADF = {
      type: 'doc',
      version: 1,
      content: description
        ? description.split('\n\n').filter(p => p.trim()).map(p => ({
            type: 'paragraph',
            content: [{ type: 'text', text: p }],
          }))
        : [],
    };
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary: summary.slice(0, 255),
      issuetype: { name: issueType },
      description: descADF,
    };
    if (typeof storyPoints === 'number') fields.customfield_10016 = storyPoints;
    // Merge dynamic custom fields (already in correct Jira format from frontend)
    if (customFields && typeof customFields === 'object') {
      for (const [k, v] of Object.entries(customFields)) {
        if (v !== null && v !== undefined && v !== '') fields[k] = v;
      }
    }

    try {
      const createRes = await fetch(`${ctx.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify({ fields }),
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error('[Jira create] error:', errText, 'payload:', JSON.stringify(fields));
        // Try to extract Jira error messages
        let detail = errText;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.errorMessages?.length) detail = errJson.errorMessages.join(' / ');
          else if (errJson.errors) detail = Object.entries(errJson.errors).map(([k, v]) => `${k}: ${v}`).join(' / ');
        } catch { /* not JSON */ }
        res.status(400).json({ error: `Jira a refuse: ${detail}`, jiraStatus: createRes.status, jiraResponse: errText });
        return;
      }
      const created = await createRes.json() as { id: string; key: string; self: string };

      // Add to sprint if specified
      if (sprintId) {
        try {
          await fetch(`${ctx.baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify({ issues: [created.key] }),
          });
        } catch (err) {
          console.warn('[Jira create] Sprint assignment failed (non-fatal):', err);
        }
      }

      // Build external URL (site URL if available)
      let siteUrl = '';
      if (ctx.isOAuth) {
        const { rows } = await db.pool.query('SELECT site_url FROM jira_tokens WHERE user_id = $1', [req.user!.id]);
        siteUrl = rows[0]?.site_url || '';
      } else {
        const { rows } = await db.pool.query(`SELECT config FROM user_connectors WHERE user_id = $1 AND service = 'jira'`, [req.user!.id]);
        const cfg = rows[0]?.config as { baseUrl?: string } | undefined;
        siteUrl = cfg?.baseUrl || '';
      }
      const externalUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${created.key}` : created.self;

      // Store link
      const link = await db.createSubjectLink(
        subjectId,
        'jira',
        created.key,
        externalUrl,
        summary,
        issueType,
        { projectKey, sprintId: sprintId || null, issueType },
        req.user!.id,
      );
      res.json({ success: true, link });
    } catch (err) {
      console.error('[Jira create] exception:', err);
      res.status(500).json({ error: (err as Error).message || 'Erreur creation Jira' });
    }
  }));

  // POST /subjects/:subjectId/create-notion-page
  router.post('/subjects/:subjectId/create-notion-page', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const { databaseId, title, content } = req.body as { databaseId: string; title: string; content?: string };

    if (!databaseId || !title) {
      res.status(400).json({ error: 'databaseId et title requis' });
      return;
    }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'create_ticket'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    try {
      const { createNotionPage } = await import('./notionService.js');
      const page = await createNotionPage(req.user!.id, databaseId, title, content || '');
      const link = await db.createSubjectLink(
        subjectId,
        'notion',
        page.id,
        page.url,
        title,
        null,
        { databaseId },
        req.user!.id,
      );
      res.json({ success: true, link });
    } catch (err) {
      console.error('[Notion create] exception:', err);
      res.status(500).json({ error: (err as Error).message || 'Erreur creation Notion' });
    }
  }));

  // GET /notion/databases — list Notion databases (for the modal dropdown)
  router.get('/notion/databases', asyncHandler(async (req, res) => {
    try {
      const { listNotionDatabases } = await import('./notionService.js');
      const dbs = await listNotionDatabases(req.user!.id);
      res.json(dbs);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message || 'Notion non disponible' });
    }
  }));

  // POST /subjects/:subjectId/create-roadmap-task
  router.post('/subjects/:subjectId/create-roadmap-task', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const { planningId, title, startDate, endDate, color, description } = req.body as {
      planningId: string; title: string; startDate: string; endDate: string; color?: string; description?: string;
    };

    if (!planningId || !title || !startDate || !endDate) {
      res.status(400).json({ error: 'planningId, title, startDate, endDate requis' });
      return;
    }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'create_ticket'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    try {
      const roadmapDb = await import('../roadmap/dbService.js');
      const task = await roadmapDb.createTask(planningId, title, startDate, endDate, { description, color });
      // Also create the bidirectional link via roadmap_task_subjects so the existing SubjectsPanel shows it
      try { await roadmapDb.linkSubject(task.id, subjectId); } catch { /* table may not exist or already linked */ }
      const externalUrl = `/roadmap/${planningId}?task=${task.id}`;
      const link = await db.createSubjectLink(
        subjectId,
        'roadmap',
        task.id,
        externalUrl,
        title,
        null,
        { planningId, startDate, endDate },
        req.user!.id,
      );
      res.json({ success: true, link, task });
    } catch (err) {
      console.error('[Roadmap create] exception:', err);
      res.status(500).json({ error: (err as Error).message || 'Erreur creation Roadmap' });
    }
  }));

  // PATCH /subjects/:subjectId/no-action — Mark a subject as "no action needed"
  // so it is excluded from future AI ticket-analysis suggestions.
  router.patch('/subjects/:subjectId/no-action', asyncHandler(async (req, res) => {
    const { subjectId } = req.params;
    const value = req.body?.noActionNeeded !== false;
    const updated = await db.setSubjectNoActionNeeded(subjectId, value);
    if (!updated) { res.status(404).json({ error: 'Sujet non trouve' }); return; }
    res.json({ id: updated.id, noActionNeeded: !!updated.no_action_needed });
  }));

  // POST /documents/:docId/analyze-subjects-for-tickets
  router.post('/documents/:docId/analyze-subjects-for-tickets', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const doc = await db.getDocumentWithSections(docId);
    if (!doc) { res.status(404).json({ error: 'Document non trouve' }); return; }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'ticket_analysis'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Credits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    // Flatten all subjects — skip those explicitly flagged as not needing action
    const allSubjects: Array<{ id: string; title: string; situation: string | null; status: string; responsibility: string | null }> = [];
    for (const section of doc.sections) {
      for (const sub of section.subjects) {
        if ((sub as { no_action_needed?: boolean }).no_action_needed) continue;
        allSubjects.push({
          id: sub.id,
          title: sub.title,
          situation: sub.situation,
          status: sub.status,
          responsibility: sub.responsibility,
        });
      }
    }

    if (allSubjects.length === 0) {
      res.json({ suggestions: [] });
      return;
    }

    try {
      const { analyzeSubjectsForTickets } = await import('./ticketAnalysisService.js');
      const suggestions = await analyzeSubjectsForTickets(req.user!.id, allSubjects);
      res.json({ suggestions });
    } catch (err) {
      console.error('[Ticket analysis] error:', err);
      res.status(500).json({ error: (err as Error).message || 'Analyse echouee' });
    }
  }));

  // ==================== Slack Collector ====================

  // Configure Slack credentials + channels for automatic collection.
  router.post('/slack/configure', asyncHandler(async (req, res) => {
    const { workspaceUrl, xoxcToken, xoxdCookie, channels, daysToFetch } = req.body;
    if (!xoxcToken || !xoxdCookie) {
      res.status(400).json({ error: 'xoxcToken et xoxdCookie sont requis' });
      return;
    }

    const { testSlackAuth, upsertSlackConfig } = await import('./slackCollectorService.js');

    // Validate credentials
    const authResult = await testSlackAuth(
      workspaceUrl || 'https://francetv.slack.com',
      xoxcToken, xoxdCookie,
    );
    if (!authResult.ok) {
      res.status(401).json({ error: authResult.error || 'Authentification Slack échouée' });
      return;
    }

    // Save config
    const config = await upsertSlackConfig(req.user!.id, {
      workspaceUrl: workspaceUrl || 'https://francetv.slack.com',
      xoxcToken,
      xoxdCookie,
      channels: channels || [],
      daysToFetch: daysToFetch ?? 7,
    });

    res.json({
      success: true,
      user: authResult.user,
      team: authResult.team,
      channelCount: config.channels.length,
    });
  }));

  // Get Slack collector status for the current user.
  router.get('/slack/status', asyncHandler(async (req, res) => {
    const { getSlackConfig, getSlackMessageCount } = await import('./slackCollectorService.js');
    const config = await getSlackConfig(req.user!.id);
    if (!config) {
      res.json({ configured: false });
      return;
    }
    const messageCount = await getSlackMessageCount(config.id);
    res.json({
      configured: true,
      isActive: config.isActive,
      lastSyncAt: config.lastSyncAt,
      channelCount: config.channels.length,
      channels: config.channels,
      messageCount,
      daysToFetch: config.daysToFetch,
    });
  }));

  // Force an immediate sync.
  router.post('/slack/sync-now', asyncHandler(async (req, res) => {
    const { syncNow } = await import('./slackCollectorService.js');
    try {
      const result = await syncNow(req.user!.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }));

  // Fetch collected Slack messages (not yet imported into SuiviTess).
  router.get('/slack/messages', asyncHandler(async (req, res) => {
    const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
    const config = await getSlackConfig(req.user!.id);
    if (!config) {
      res.json([]);
      return;
    }
    const days = parseInt(req.query.days as string, 10) || config.daysToFetch;
    const channelId = (req.query.channelId as string) || undefined;
    const messages = await getSlackMessages(config.id, {
      days,
      channelId,
      excludeImportedFor: req.user!.id,
    });

    // Group messages by channel + day into digest items so the AI can
    // analyse a full day's conversation at once rather than message by message.
    const items = groupSlackMessagesByDay(messages);
    res.json(items);
  }));

  // Delete Slack configuration for the current user.
  router.delete('/slack/configure', asyncHandler(async (req, res) => {
    const { deleteSlackConfig } = await import('./slackCollectorService.js');
    await deleteSlackConfig(req.user!.id);
    res.json({ success: true });
  }));

  // ==================== Outlook Collector ====================

  // Push scraped Outlook emails from the Chrome extension.
  router.post('/outlook/sync', asyncHandler(async (req, res) => {
    const { emails } = req.body as { emails?: Array<{
      id: string; subject: string; sender: string; date: string;
      preview: string; body?: string;
    }> };
    if (!Array.isArray(emails) || emails.length === 0) {
      res.status(400).json({ error: 'Aucun email à synchroniser' });
      return;
    }
    const { storeOutlookEmails } = await import('./outlookCollectorService.js');
    const result = await storeOutlookEmails(req.user!.id, emails.slice(0, 200));
    res.json(result);
  }));

  // Get Outlook collector status.
  router.get('/outlook/status', asyncHandler(async (req, res) => {
    const { getOutlookMessageCount } = await import('./outlookCollectorService.js');
    const count = await getOutlookMessageCount(req.user!.id);
    res.json({ configured: count > 0, messageCount: count });
  }));

  // ==================== Bulk transcription import (list-level) ====================

  // GET /transcription/sync-meta — returns the last-sync / message-count
  // for each collector, so the modal can show "Dernière synchro Slack :
  // il y a 3 min (12 messages)" even when there's no new content.
  router.get('/transcription/sync-meta', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    type ProviderMeta = {
      configured: boolean;
      isActive?: boolean;
      lastSyncAt: string | null;
      messageCount: number;
      channelCount?: number;
      daysToFetch?: number;
      error?: string;
    };
    const meta: { slack: ProviderMeta; outlook: ProviderMeta } = {
      slack:   { configured: false, lastSyncAt: null, messageCount: 0 },
      outlook: { configured: false, lastSyncAt: null, messageCount: 0 },
    };
    try {
      const { getSlackConfig, getSlackMessageCount } = await import('./slackCollectorService.js');
      const sc = await getSlackConfig(userId);
      if (sc) {
        meta.slack = {
          configured: true,
          isActive: sc.isActive,
          lastSyncAt: sc.lastSyncAt,
          messageCount: await getSlackMessageCount(sc.id),
          channelCount: sc.channels.length,
          daysToFetch: sc.daysToFetch,
        };
      }
    } catch (err) { meta.slack.error = (err as Error).message; }
    try {
      const { getOutlookMessageCount } = await import('./outlookCollectorService.js');
      const count = await getOutlookMessageCount(userId);
      // We don't track Outlook sync time separately — the extension posts
      // whenever the user opens Outlook, so the latest collected email's
      // `date` is our best proxy.
      const { rows } = await db.pool.query(
        `SELECT MAX(collected_at) AS last FROM outlook_messages WHERE user_id = $1`,
        [userId],
      ).catch(() => ({ rows: [] as Array<{ last: string | null }> }));
      meta.outlook = {
        configured: count > 0,
        lastSyncAt: rows[0]?.last ?? null,
        messageCount: count,
      };
    } catch (err) { meta.outlook.error = (err as Error).message; }
    res.json(meta);
  }));

  // POST /transcription/sync-all — triggers a sync for every configured
  // collector (currently only Slack, since Outlook is push-based).
  // Returns the per-provider result. Non-blocking (awaited serially is
  // fine — one Slack sync is ~1 s).
  router.post('/transcription/sync-all', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    type Result = { ok: boolean; total?: number; error?: string };
    const out: { slack: Result } = { slack: { ok: false } };
    try {
      const { syncNow } = await import('./slackCollectorService.js');
      const r = await syncNow(userId);
      out.slack = { ok: true, total: r.total };
    } catch (err) {
      out.slack = { ok: false, error: (err as Error).message };
    }
    res.json(out);
  }));

  // Aggregate calls + emails across every connected provider.
  // Returns a unified list the UI can show and let the user re-route.
  router.get('/transcription/bulk-sources', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const days = Math.min(60, Math.max(1, parseInt(req.query.days as string, 10) || 30));

    type Item = {
      id: string;
      provider: 'fathom' | 'otter' | 'gmail' | 'outlook';
      title: string;
      date: string | null;
      participants?: string[];
      preview?: string;
    };
    const items: Item[] = [];

    // Try every provider in parallel ; a missing token / unconfigured
    // connector just yields an empty list without blocking the others.
    const [fathomCalls, otterCalls, outlookEmails, gmailEmails] = await Promise.all([
      (async () => {
        try {
          const { listFathomCalls } = await import('./fathomService.js');
          return await listFathomCalls(userId, days);
        } catch { return []; }
      })(),
      (async () => {
        try {
          const { listOtterCalls } = await import('./otterService.js');
          return await listOtterCalls(userId, days);
        } catch { return []; }
      })(),
      (async () => {
        try {
          const { listOutlookEmails } = await import('./emailService.js');
          return await listOutlookEmails(userId, Math.min(14, days));
        } catch { return []; }
      })(),
      (async () => {
        try {
          const { listGmailEmails } = await import('./emailService.js');
          return await listGmailEmails(userId, Math.min(14, days));
        } catch { return []; }
      })(),
    ]);

    for (const c of fathomCalls) {
      items.push({
        id: c.id,
        provider: 'fathom',
        title: c.title,
        date: (c as { date?: string | null }).date ?? null,
        participants: (c as { participants?: string[] }).participants,
      });
    }
    for (const c of otterCalls) {
      items.push({
        id: c.id,
        provider: 'otter',
        title: c.title,
        date: (c as { date?: string | null }).date ?? null,
        participants: (c as { participants?: string[] }).participants,
      });
    }
    for (const e of outlookEmails) {
      items.push({
        id: e.id,
        provider: 'outlook',
        title: `${e.subject} (${e.sender})`,
        date: (e as { date?: string | null }).date ?? null,
        preview: (e as { preview?: string }).preview,
      });
    }
    for (const e of gmailEmails) {
      items.push({
        id: e.id,
        provider: 'gmail',
        title: `${e.subject} (${e.sender})`,
        date: (e as { date?: string | null }).date ?? null,
        preview: (e as { preview?: string }).preview,
      });
    }

    // Slack collected messages — we keep already-imported digests in the
    // list and tag them with `alreadyImported` below, so the UI can offer
    // a "Ré-importer" action.
    try {
      const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
      const slackConfig = await getSlackConfig(userId);
      if (slackConfig && slackConfig.isActive) {
        const slackMsgs = await getSlackMessages(slackConfig.id, {
          days: Math.min(30, days),
        });
        const slackDigests = groupSlackMessagesByDay(slackMsgs);
        items.push(...slackDigests);
      }
    } catch { /* Slack collector may not be initialized */ }

    // Outlook collected emails (pushed from the Chrome extension).
    // We keep already-imported digests in the result : the UI shows them
    // with a "Déjà importé" badge + a "Ré-importer" action, same pattern
    // as the per-document TranscriptionWizard.
    try {
      const { getOutlookMessages, groupOutlookMessagesByDay } = await import('./outlookCollectorService.js');
      const outlookMsgs = await getOutlookMessages(userId, {
        days: Math.min(30, days),
        excludeImported: false,
      });
      if (outlookMsgs.length > 0) {
        const outlookDigests = groupOutlookMessagesByDay(outlookMsgs);
        items.push(...outlookDigests);
      }
    } catch { /* Outlook collector may not be initialized */ }

    // Mark items already imported — we keep them in the list so the user
    // can re-import on purpose, just tagged so the UI can show them greyed.
    try {
      const { rows } = await db.pool.query(
        `SELECT call_id FROM suivitess_transcript_imports
         WHERE document_id IN (SELECT id FROM suivitess_documents WHERE owner_id = $1 OR owner_id IS NULL)`,
        [userId],
      );
      const imported = new Set(rows.map(r => r.call_id as string));
      for (const item of items) {
        if (imported.has(item.id)) (item as { alreadyImported?: boolean }).alreadyImported = true;
      }
    } catch { /* already-imported table may not exist yet — keep everything */ }

    // Sort by date desc, cap
    items.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    res.json(items.slice(0, 50));
  }));

  // POST /transcription/analyze-and-route
  // body: { source: 'fathom'|'otter'|'gmail'|'outlook', id: string, title: string, date?: string }
  // Fetches the transcript/email body, loads the user's reviews WITH their
  // sections + sample subjects, then asks the AI to extract subjects and
  // suggest a review + section for each.
  router.post('/transcription/analyze-and-route', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { source, id, title, date } = (req.body || {}) as {
      source?: string; id?: string; title?: string; date?: string | null;
    };
    if (!source || !id) {
      res.status(400).json({ error: 'source et id sont requis' });
      return;
    }

    // 1) Fetch the raw transcript / email body in a provider-agnostic way.
    let transcript = '';
    try {
      if (source === 'fathom') {
        const { getFathomTranscript } = await import('./fathomService.js');
        const entries = await getFathomTranscript(userId, id);
        transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
      } else if (source === 'otter') {
        const { getOtterTranscript } = await import('./otterService.js');
        const entries = await getOtterTranscript(userId, id);
        transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
      } else if (source === 'outlook') {
        // If the id is a digest "outlook:YYYY-MM-DD", build transcript from stored emails
        if (id.startsWith('outlook:')) {
          const dateFilter = id.replace('outlook:', '');
          const { getOutlookMessages } = await import('./outlookCollectorService.js');
          const msgs = await getOutlookMessages(userId, { days: 30 });
          const filtered = dateFilter && dateFilter !== 'unknown'
            ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
            : msgs;
          transcript = filtered
            .map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`)
            .join('\n');
        } else {
          // Legacy: single email via OAuth
          const { getOutlookEmailBody } = await import('./emailService.js');
          transcript = await getOutlookEmailBody(userId, id);
        }
      } else if (source === 'gmail') {
        const { getGmailEmailBody } = await import('./emailService.js');
        transcript = await getGmailEmailBody(userId, id);
      } else if (source === 'slack') {
        // The id is "slack:channelId:YYYY-MM-DD" (digest format).
        // Build a transcript from all messages of that channel on that day.
        const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
        const slackConfig = await getSlackConfig(userId);
        if (!slackConfig) {
          res.status(400).json({ error: 'Slack non configuré. Utilisez l\'extension Chrome pour connecter Slack.' });
          return;
        }
        const parts = id.split(':');
        const channelId = parts[1] || parts[0];
        const dateFilter = parts[2]; // YYYY-MM-DD or undefined
        const messages = await getSlackMessages(slackConfig.id, {
          days: slackConfig.daysToFetch,
          channelId,
        });
        // Filter to the specific day if provided
        const filtered = dateFilter
          ? messages.filter(m => {
              const d = new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10);
              return d === dateFilter;
            })
          : messages;
        transcript = filtered
          .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
          .map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`)
          .join('\n');
      } else {
        res.status(400).json({ error: `Source non supportée : ${source}` });
        return;
      }
    } catch (err) {
      res.status(502).json({ error: (err as Error).message || 'Récupération de la transcription échouée' });
      return;
    }

    if (!transcript.trim()) {
      res.status(400).json({ error: 'Transcription vide' });
      return;
    }

    // 2) Charge credits BEFORE the AI call.
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(userId, req.user!.isAdmin, 'suivitess', 'transcript_analysis'); }
    catch (e) {
      if (e instanceof InsufficientCreditsError) {
        res.status(402).json({ error: 'INSUFFICIENT_CREDITS', required: e.required, available: e.available });
        return;
      }
      throw e;
    }

    // 3) Build the reviews-with-sections snapshot the AI needs.
    const existingDocs = await db.getAllDocuments(userId, req.user!.isAdmin);
    const reviews: Array<{
      id: string;
      title: string;
      description: string | null;
      sections: Array<{
        id: string;
        name: string;
        subjects: Array<{ id: string; title: string; status: string | null; situationExcerpt: string; responsibility: string | null }>;
      }>;
    }> = [];

    for (const d of existingDocs.slice(0, 40)) {
      try {
        const doc = await db.getDocumentWithSections(d.id);
        if (!doc) continue;
        reviews.push({
          id: doc.id,
          title: doc.title,
          description: (d as { description?: string | null }).description ?? null,
          sections: (doc.sections || []).map(s => ({
            id: s.id,
            name: s.name,
            subjects: (s.subjects || []).slice(0, 20).map(sub => ({
              id: sub.id,
              title: sub.title,
              status: sub.status ?? null,
              situationExcerpt: (sub.situation || '').slice(0, 200),
              responsibility: sub.responsibility ?? null,
            })),
          })),
        });
      } catch {
        /* best effort */
      }
    }

    // 4) Run AI — modular 3-tier pipeline (always active).
    const availableReviewsPayload = reviews.map(r => ({
      id: r.id,
      title: r.title,
      sections: r.sections.map(s => ({
        id: s.id,
        name: s.name,
        subjects: s.subjects.map(sub => ({ id: sub.id, title: sub.title, status: sub.status, situation: sub.situation ?? null })),
      })),
    }));

    const { analyzeSourceForReviews } = await import('../aiSkills/analyzeSourcePipeline.js');

    try {
      const { proposals, rootLogId } = await analyzeSourceForReviews({
        sourceKind: source as 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail',
        sourceRaw: transcript,
        sourceTitle: title || '(sans titre)',
        reviews,
        userId,
        userEmail: req.user!.email || '',
      });
      res.json({
        summary: proposals.length > 0 ? `${proposals.length} sujet(s) extrait(s) et routé(s).` : 'Aucun sujet exploitable.',
        subjects: proposals,
        logId: rootLogId,
        availableReviews: availableReviewsPayload,
      });
    } catch (err) {
      console.error('[SuiviTess pipeline routing] error:', err);
      res.status(500).json({ error: (err as Error).message || 'Analyse échouée' });
    }
  }));

  // ── POST /transcription/analyze-and-route-async ─────────────────────
  // Same inputs as /analyze-and-route, but returns a { jobId } IMMEDIATELY
  // and runs the pipeline in the background. The frontend polls
  // GET /suivitess/api/pipeline-jobs/:jobId every ~500 ms to drive the
  // real progress indicator (T1/T2/T3 boundaries, writer count).
  // Replaces the fake-timer PipelineStepsIndicator.
  router.post('/transcription/analyze-and-route-async', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const isAdmin = req.user!.isAdmin;
    const { source, id, title, date } = (req.body || {}) as {
      source?: string; id?: string; title?: string; date?: string | null;
    };
    if (!source || !id) { res.status(400).json({ error: 'source et id sont requis' }); return; }

    const { createJob, makeOnProgress, finishJob, failJob } = await import('../aiSkills/pipelineJobs.js');
    const job = createJob();
    res.json({ jobId: job.id });

    // ── Run in background after the HTTP response has been sent. ──
    // We use setImmediate so any error inside never crashes the response.
    setImmediate(async () => {
      try {
        // 1) Fetch the raw transcript / email body (same as the sync route).
        let transcript = '';
        if (source === 'fathom') {
          const { getFathomTranscript } = await import('./fathomService.js');
          const entries = await getFathomTranscript(userId, id);
          transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
        } else if (source === 'otter') {
          const { getOtterTranscript } = await import('./otterService.js');
          const entries = await getOtterTranscript(userId, id);
          transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
        } else if (source === 'outlook') {
          if (id.startsWith('outlook:')) {
            const dateFilter = id.replace('outlook:', '');
            const { getOutlookMessages } = await import('./outlookCollectorService.js');
            const msgs = await getOutlookMessages(userId, { days: 30 });
            const filtered = dateFilter && dateFilter !== 'unknown'
              ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
              : msgs;
            transcript = filtered.map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`).join('\n');
          } else {
            const { getOutlookEmailBody } = await import('./emailService.js');
            transcript = await getOutlookEmailBody(userId, id);
          }
        } else if (source === 'gmail') {
          const { getGmailEmailBody } = await import('./emailService.js');
          transcript = await getGmailEmailBody(userId, id);
        } else if (source === 'slack') {
          const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
          const slackConfig = await getSlackConfig(userId);
          if (!slackConfig) { failJob(job.id, 'Slack non configuré'); return; }
          const parts = id.split(':');
          const channelId = parts[1] || parts[0];
          const dateFilter = parts[2];
          const messages = await getSlackMessages(slackConfig.id, { days: slackConfig.daysToFetch, channelId });
          const filtered = dateFilter ? messages.filter(m => {
            const d = new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10);
            return d === dateFilter;
          }) : messages;
          transcript = filtered
            .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
            .map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`)
            .join('\n');
        } else {
          failJob(job.id, `Source non supportée : ${source}`);
          return;
        }
        if (!transcript.trim()) { failJob(job.id, 'Transcription vide'); return; }

        // 2) Credits.
        const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
        try { await deductCredits(userId, isAdmin, 'suivitess', 'transcript_analysis'); }
        catch (e) {
          if (e instanceof InsufficientCreditsError) { failJob(job.id, 'INSUFFICIENT_CREDITS'); return; }
          throw e;
        }

        // 3) Build reviews snapshot.
        const existingDocs = await db.getAllDocuments(userId, isAdmin);
        const reviewsSnap: Array<{
          id: string; title: string; description: string | null;
          sections: Array<{
            id: string; name: string;
            subjects: Array<{ id: string; title: string; status: string | null; situationExcerpt: string; responsibility: string | null }>;
          }>;
        }> = [];
        for (const d of existingDocs.slice(0, 40)) {
          try {
            const doc = await db.getDocumentWithSections(d.id);
            if (!doc) continue;
            reviewsSnap.push({
              id: doc.id,
              title: doc.title,
              description: (d as { description?: string | null }).description ?? null,
              sections: (doc.sections || []).map(s => ({
                id: s.id,
                name: s.name,
                subjects: (s.subjects || []).slice(0, 20).map(sub => ({
                  id: sub.id,
                  title: sub.title,
                  status: sub.status ?? null,
                  situationExcerpt: (sub.situation || '').slice(0, 200),
                  responsibility: sub.responsibility ?? null,
                })),
              })),
            });
          } catch { /* best effort */ }
        }

        // 4) Run pipeline with progress callbacks.
        const { analyzeSourceForReviews } = await import('../aiSkills/analyzeSourcePipeline.js');
        const onProgress = makeOnProgress(job.id);
        const { proposals, rootLogId } = await analyzeSourceForReviews({
          sourceKind: source as 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail',
          sourceRaw: transcript,
          sourceTitle: title || '(sans titre)',
          reviews: reviewsSnap,
          userId,
          userEmail: userEmail || '',
        }, onProgress);

        finishJob(job.id, {
          summary: proposals.length > 0 ? `${proposals.length} sujet(s) extrait(s) et routé(s).` : 'Aucun sujet exploitable.',
          subjects: proposals,
          logId: rootLogId,
          availableReviews: reviewsSnap.map(r => ({
            id: r.id,
            title: r.title,
            sections: r.sections.map(s => ({
              id: s.id,
              name: s.name,
              subjects: s.subjects.map(sub => ({ id: sub.id, title: sub.title, status: sub.status, situation: sub.situation ?? null })),
            })),
          })),
        });
      } catch (err) {
        console.error('[SuiviTess pipeline routing async] error:', err);
        failJob(job.id, err instanceof Error ? err.message : 'Erreur inconnue');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void date;
    });
  }));

  // ── POST /multi-source/analyze-async ────────────────────────────────
  // Multi-source import variant of analyze-and-route-async. Takes an
  // array of source descriptors (2..10), fetches each one's raw content,
  // then runs the full T1 × N → T1.5 reconcile → T2 → T3 pipeline.
  // Returns a { jobId } immediately ; frontend polls /pipeline-jobs/:id.
  // If only 1 source is passed, falls back to the single-source pipeline
  // (same behavior as /analyze-and-route-async).
  router.post('/multi-source/analyze-async', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const isAdmin = req.user!.isAdmin;
    const { sources } = (req.body || {}) as {
      sources?: Array<{ source: string; id: string; title?: string; date?: string | null }>;
    };
    if (!Array.isArray(sources) || sources.length === 0) {
      res.status(400).json({ error: 'sources[] requis (au moins 1 source)' });
      return;
    }
    if (sources.length > 10) {
      res.status(400).json({ error: 'Maximum 10 sources à la fois — regroupe en 2 batches' });
      return;
    }

    const { createJob, makeOnProgress, finishJob, failJob } = await import('../aiSkills/pipelineJobs.js');
    const job = createJob();
    res.json({ jobId: job.id });

    setImmediate(async () => {
      try {
        // 1) Fetch raw content for every source in parallel.
        const fetchSource = async (s: typeof sources[number]) => {
          let raw = '';
          let ts = s.date || new Date().toISOString();
          const { source, id } = s;
          if (source === 'fathom') {
            const { getFathomTranscript } = await import('./fathomService.js');
            const entries = await getFathomTranscript(userId, id);
            raw = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
          } else if (source === 'otter') {
            const { getOtterTranscript } = await import('./otterService.js');
            const entries = await getOtterTranscript(userId, id);
            raw = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
          } else if (source === 'outlook') {
            if (id.startsWith('outlook:')) {
              const dateFilter = id.replace('outlook:', '');
              const { getOutlookMessages } = await import('./outlookCollectorService.js');
              const msgs = await getOutlookMessages(userId, { days: 30 });
              const filtered = dateFilter && dateFilter !== 'unknown'
                ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
                : msgs;
              raw = filtered.map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`).join('\n');
              if (filtered[0]?.date) ts = filtered[0].date;
            } else {
              const { getOutlookEmailBody } = await import('./emailService.js');
              raw = await getOutlookEmailBody(userId, id);
            }
          } else if (source === 'gmail') {
            const { getGmailEmailBody } = await import('./emailService.js');
            raw = await getGmailEmailBody(userId, id);
          } else if (source === 'slack') {
            const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
            const slackConfig = await getSlackConfig(userId);
            if (!slackConfig) throw new Error('Slack non configuré');
            const parts = id.split(':');
            const channelId = parts[1] || parts[0];
            const dateFilter = parts[2];
            const messages = await getSlackMessages(slackConfig.id, { days: slackConfig.daysToFetch, channelId });
            const filtered = dateFilter ? messages.filter(m => {
              const d = new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10);
              return d === dateFilter;
            }) : messages;
            const sorted = filtered.sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs));
            raw = sorted.map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`).join('\n');
            if (sorted[0]?.messageTs) ts = new Date(parseFloat(sorted[0].messageTs) * 1000).toISOString();
          } else {
            throw new Error(`Source non supportée : ${source}`);
          }
          return {
            sourceId: `${source}:${id}`,
            sourceKind: source as 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail',
            sourceTitle: s.title || `(${source}) ${id}`,
            sourceTimestamp: ts,
            sourceRaw: raw,
          };
        };

        const fetched = await Promise.all(sources.map(fetchSource));
        const usable = fetched.filter(s => s.sourceRaw.trim().length > 0);
        if (usable.length === 0) { failJob(job.id, 'Toutes les sources sont vides'); return; }

        // 2) Credits — 1 deduction per source to stay fair with single-source cost.
        const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
        try {
          for (const _s of usable) {
            await deductCredits(userId, isAdmin, 'suivitess', 'transcript_analysis');
            void _s;
          }
        } catch (e) {
          if (e instanceof InsufficientCreditsError) { failJob(job.id, 'INSUFFICIENT_CREDITS'); return; }
          throw e;
        }

        // 3) Build reviews snapshot (identical to single-source endpoint).
        const existingDocs = await db.getAllDocuments(userId, isAdmin);
        const reviewsSnap: Array<{
          id: string; title: string; description: string | null;
          sections: Array<{
            id: string; name: string;
            subjects: Array<{ id: string; title: string; status: string | null; situationExcerpt: string; responsibility: string | null }>;
          }>;
        }> = [];
        for (const d of existingDocs.slice(0, 40)) {
          try {
            const doc = await db.getDocumentWithSections(d.id);
            if (!doc) continue;
            reviewsSnap.push({
              id: doc.id,
              title: doc.title,
              description: (d as { description?: string | null }).description ?? null,
              sections: (doc.sections || []).map(s => ({
                id: s.id,
                name: s.name,
                subjects: (s.subjects || []).slice(0, 20).map(sub => ({
                  id: sub.id,
                  title: sub.title,
                  status: sub.status ?? null,
                  situationExcerpt: (sub.situation || '').slice(0, 200),
                  responsibility: sub.responsibility ?? null,
                })),
              })),
            });
          } catch { /* best effort */ }
        }

        // 4) Run multi-source pipeline.
        const { analyzeMultiSourceForReviews } = await import('../aiSkills/analyzeSourcePipeline.js');
        const onProgress = makeOnProgress(job.id);
        const result = await analyzeMultiSourceForReviews({
          sources: usable,
          reviews: reviewsSnap,
          userId,
          userEmail: userEmail || '',
        }, onProgress);

        finishJob(job.id, {
          summary: result.proposals.length > 0
            ? `${result.proposals.length} sujet(s) proposé(s) à partir de ${usable.length} source(s).`
            : 'Aucun sujet exploitable.',
          subjects: result.proposals,
          consolidationByProposal: result.consolidationByProposal,
          sourcesCount: usable.length,
          logId: result.rootLogId,
          availableReviews: reviewsSnap.map(r => ({
            id: r.id,
            title: r.title,
            sections: r.sections.map(s => ({
              id: s.id,
              name: s.name,
              subjects: s.subjects.map(sub => ({ id: sub.id, title: sub.title, status: sub.status, situation: sub.situation ?? null })),
            })),
          })),
        });
      } catch (err) {
        console.error('[SuiviTess multi-source async] error:', err);
        failJob(job.id, err instanceof Error ? err.message : 'Erreur inconnue');
      }
    });
  }));

  // ── GET /pipeline-jobs/:id ──────────────────────────────────────────
  // Generic polling endpoint for any async pipeline job (bulk import,
  // content-import, transcript-merge). Returns the full job state —
  // phase, counts, durations, and the final result when phase === 'done'.
  router.get('/pipeline-jobs/:id', asyncHandler(async (req, res) => {
    const { getJob } = await import('../aiSkills/pipelineJobs.js');
    const job = getJob(String(req.params.id));
    if (!job) { res.status(404).json({ error: 'Job introuvable (ou expiré après 15 min)' }); return; }
    res.json(job);
  }));

  // POST /transcription/analyze-and-route-stream
  // Streaming variant of the above : same body, but returns an SSE stream
  // with the AI's narrated journal + the final result once parsed.
  router.post('/transcription/analyze-and-route-stream', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { source, id, title, date } = (req.body || {}) as {
      source?: string; id?: string; title?: string; date?: string | null;
    };
    if (!source || !id) {
      res.status(400).json({ error: 'source et id sont requis' });
      return;
    }

    // Reuse the same transcript-fetching logic as the non-streamed route.
    let transcript = '';
    try {
      if (source === 'fathom') {
        const { getFathomTranscript } = await import('./fathomService.js');
        const entries = await getFathomTranscript(userId, id);
        transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
      } else if (source === 'otter') {
        const { getOtterTranscript } = await import('./otterService.js');
        const entries = await getOtterTranscript(userId, id);
        transcript = entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
      } else if (source === 'outlook') {
        if (id.startsWith('outlook:')) {
          const dateFilter = id.replace('outlook:', '');
          const { getOutlookMessages } = await import('./outlookCollectorService.js');
          const msgs = await getOutlookMessages(userId, { days: 30 });
          const filtered = dateFilter && dateFilter !== 'unknown'
            ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
            : msgs;
          transcript = filtered.map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`).join('\n');
        } else {
          const { getOutlookEmailBody } = await import('./emailService.js');
          transcript = await getOutlookEmailBody(userId, id);
        }
      } else if (source === 'gmail') {
        const { getGmailEmailBody } = await import('./emailService.js');
        transcript = await getGmailEmailBody(userId, id);
      } else if (source === 'slack') {
        const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
        const slackConfig = await getSlackConfig(userId);
        if (!slackConfig) { res.status(400).json({ error: 'Slack non configuré.' }); return; }
        const parts = id.split(':');
        const channelId = parts[1] || parts[0];
        const dateFilter = parts[2];
        const messages = await getSlackMessages(slackConfig.id, { days: slackConfig.daysToFetch, channelId });
        const filtered = dateFilter
          ? messages.filter(m => new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10) === dateFilter)
          : messages;
        transcript = filtered
          .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
          .map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`).join('\n');
      } else {
        res.status(400).json({ error: `Source non supportée : ${source}` }); return;
      }
    } catch (err) {
      res.status(502).json({ error: (err as Error).message || 'Récupération échouée' });
      return;
    }

    if (!transcript.trim()) { res.status(400).json({ error: 'Transcription vide' }); return; }

    // Credits — same quota as the non-streamed endpoint.
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(userId, req.user!.isAdmin, 'suivitess', 'transcript_analysis'); }
    catch (e) {
      if (e instanceof InsufficientCreditsError) {
        res.status(402).json({ error: 'INSUFFICIENT_CREDITS', required: e.required, available: e.available });
        return;
      }
      throw e;
    }

    // Build the reviews snapshot.
    const existingDocs = await db.getAllDocuments(userId, req.user!.isAdmin);
    const reviews = [];
    for (const d of existingDocs.slice(0, 40)) {
      try {
        const doc = await db.getDocumentWithSections(d.id);
        if (!doc) continue;
        reviews.push({
          id: doc.id,
          title: doc.title,
          description: (d as { description?: string | null }).description ?? null,
          sections: (doc.sections || []).map(s => ({
            id: s.id,
            name: s.name,
            subjects: (s.subjects || []).slice(0, 20).map(sub => ({
              id: sub.id,
              title: sub.title,
              status: sub.status ?? null,
              situationExcerpt: (sub.situation || '').slice(0, 200),
              responsibility: sub.responsibility ?? null,
            })),
          })),
        });
      } catch { /* skip this review */ }
    }

    const { streamRouting } = await import('./streamingRoutingService.js');
    await streamRouting(res, {
      userId,
      userEmail: req.user!.email,
      transcript,
      reviews,
      callMeta: { title: title || '(sans titre)', date: date ?? null, provider: source },
    });
  }));

  // POST /transcription/apply-routing
  // Body: { subjects: [{ title, situation, status, responsibility,
  //                      targetReviewId?, newReviewTitle?,
  //                      targetSectionId?, newSectionName? }] }
  // Applies the user-confirmed routing : creates reviews and sections as
  // needed, then appends each subject. Sections with the same name inside
  // the same review are de-duplicated (created once).
  // Re-generate an "append text" for an existing subject when the user
  // overrides the IA's routing in the bulk-import wizard (e.g. the IA
  // proposed "new subject" but the user picked an existing target to
  // append to). Runs the suivitess-append-situation skill on demand.
  router.post('/transcription/generate-append-text', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { existingSituation, rawQuotes, subjectTitle, sourceKind, sourceTitle } = (req.body || {}) as {
      existingSituation?: string;
      rawQuotes?: string[];
      subjectTitle?: string;
      sourceKind?: string;
      sourceTitle?: string;
    };
    if (typeof existingSituation !== 'string' || !Array.isArray(rawQuotes) || !subjectTitle) {
      res.status(400).json({ error: 'existingSituation, rawQuotes, subjectTitle requis' });
      return;
    }
    const { runSkill } = await import('../aiSkills/runSkill.js');
    const todayFrFr = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const ctx = { existingSituation, rawQuotes, today: todayFrFr(), subjectTitle };
    try {
      const run = await runSkill({
        slug: 'suivitess-append-situation',
        userId,
        userEmail: req.user!.email || '',
        buildContext: () => `## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "appendText": … }.`,
        inputContent: JSON.stringify(ctx),
        sourceKind: (sourceKind as 'transcript' | 'slack' | 'outlook') ?? 'transcript',
        sourceTitle: sourceTitle ?? 'regeneration',
        documentId: null,
        parentLogId: null,
        maxTokens: 800,
      });
      const match = run.outputText.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) as { appendText?: string | null } : null;
      res.json({ appendText: parsed?.appendText ?? null, logId: run.logId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Échec génération' });
    }
  }));

  // Compose a fresh subject "situation" on demand when the user
  // overrides the IA's routing from update → create. The original
  // IA pipeline emits `situation: ''` for update proposals (the
  // writer runs append-situation, not compose-situation), so there's
  // no pre-computed text to preview when the user flips the decision.
  router.post('/transcription/generate-compose-text', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { title, rawQuotes, sourceKind, sourceTitle } = (req.body || {}) as {
      title?: string;
      rawQuotes?: string[];
      sourceKind?: string;
      sourceTitle?: string;
    };
    if (!title || !Array.isArray(rawQuotes)) {
      res.status(400).json({ error: 'title, rawQuotes requis' });
      return;
    }
    const { runSkill } = await import('../aiSkills/runSkill.js');
    const ctx = { title, rawQuotes };
    try {
      const run = await runSkill({
        slug: 'suivitess-compose-situation',
        userId,
        userEmail: req.user!.email || '',
        buildContext: () => `## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "situation": … }.`,
        inputContent: JSON.stringify(ctx),
        sourceKind: (sourceKind as 'transcript' | 'slack' | 'outlook') ?? 'transcript',
        sourceTitle: sourceTitle ?? 'compose',
        documentId: null,
        parentLogId: null,
        maxTokens: 800,
      });
      const match = run.outputText.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) as { situation?: string } : null;
      res.json({ situation: parsed?.situation ?? '', logId: run.logId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Échec génération' });
    }
  }));

  // Document-scoped bulk import — ASYNC variant that mirrors the
  // global multi-source flow : returns { jobId } immediately, runs
  // the pipeline in background and feeds the PipelineStepsIndicator
  // via `/pipeline-jobs/:id` polling. Skips place-in-reviews and
  // uses analyzeSourceForDocument (section + subject only) per
  // selected source, then adapts each proposal to the shape the
  // bulk modal expects.
  router.post('/documents/:docId/bulk-analyze', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const isAdmin = req.user!.isAdmin;
    const { docId } = req.params;
    const { sources } = (req.body || {}) as {
      sources?: Array<{ source: string; id: string; title: string; date?: string | null }>;
    };
    if (!Array.isArray(sources) || sources.length === 0) {
      res.status(400).json({ error: 'sources[] requis' });
      return;
    }

    const doc = await db.getDocumentWithSections(docId);
    if (!doc) {
      res.status(404).json({ error: 'Document non trouvé' });
      return;
    }

    const { createJob, makeOnProgress, finishJob, failJob } = await import('../aiSkills/pipelineJobs.js');
    const job = createJob();
    res.json({ jobId: job.id });

    setImmediate(async () => {
      try {
        const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
        try {
          await deductCredits(userId, isAdmin, 'suivitess', 'transcript_analysis');
        } catch (e) {
          if (e instanceof InsufficientCreditsError) { failJob(job.id, 'INSUFFICIENT_CREDITS'); return; }
          throw e;
        }

        const { analyzeSourceForDocument } = await import('../aiSkills/analyzeSourcePipeline.js');

        const documentCtx = {
          id: String(doc.id),
          title: doc.title,
          sections: doc.sections.map(s => ({
            id: String(s.id),
            name: s.name,
            subjects: s.subjects.map(sub => ({
              id: String(sub.id),
              title: sub.title,
              situationExcerpt: (sub.situation || '').slice(0, 2000),
              status: sub.status,
              responsibility: sub.responsibility ?? null,
            })),
          })),
        };

        // Same multiplex as the streaming bulk endpoint.
        async function fetchSourceText(src: { source: string; id: string; title: string }): Promise<string | null> {
          try {
            if (src.source === 'fathom') {
              const { getFathomTranscript } = await import('./fathomService.js');
              const entries = await getFathomTranscript(userId, src.id);
              return entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
            }
            if (src.source === 'otter') {
              const { getOtterTranscript } = await import('./otterService.js');
              const entries = await getOtterTranscript(userId, src.id);
              return entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
            }
            if (src.source === 'outlook') {
              if (src.id.startsWith('outlook:')) {
                const dateFilter = src.id.replace('outlook:', '');
                const { getOutlookMessages } = await import('./outlookCollectorService.js');
                const msgs = await getOutlookMessages(userId, { days: 30 });
                const filtered = dateFilter && dateFilter !== 'unknown'
                  ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
                  : msgs;
                return filtered.map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`).join('\n');
              }
              const { getOutlookEmailBody } = await import('./emailService.js');
              return await getOutlookEmailBody(userId, src.id);
            }
            if (src.source === 'gmail') {
              const { getGmailEmailBody } = await import('./emailService.js');
              return await getGmailEmailBody(userId, src.id);
            }
            if (src.source === 'slack') {
              const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
              const slackConfig = await getSlackConfig(userId);
              if (!slackConfig) return null;
              const parts = src.id.split(':');
              const channelId = parts[1] || parts[0];
              const dateFilter = parts[2];
              const messages = await getSlackMessages(slackConfig.id, { days: slackConfig.daysToFetch, channelId });
              const filtered = dateFilter
                ? messages.filter(m => new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10) === dateFilter)
                : messages;
              return filtered
                .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
                .map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`).join('\n');
            }
            return null;
          } catch (err) {
            console.warn(`[doc-bulk-analyze] failed to fetch ${src.source}/${src.id}:`, err);
            return null;
          }
        }

        // Progress bridge : we have N sources and each runs a full
        // T1 → T2 → T3 pipeline. The frontend indicator uses the
        // first-source boundaries as a good enough signal (it's what
        // the multi-source bulk does). We fan progress from every
        // source into the same onProgress → the user sees t1/t2/t3
        // ticks as they happen.
        const onProgress = makeOnProgress(job.id);

        const allProposals: FinalReviewProposalAdapted[] = [];
        let lastLogId: number | null = null;
        for (const src of sources) {
          const text = await fetchSourceText(src);
          if (!text || !text.trim()) continue;
          const sourceKind: 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail' =
            src.source === 'slack' ? 'slack'
            : src.source === 'outlook' ? 'outlook'
            : src.source === 'gmail' ? 'gmail'
            : src.source === 'fathom' ? 'transcript'
            : src.source === 'otter' ? 'transcript'
            : 'transcript';
          try {
            const { proposals, rootLogId } = await analyzeSourceForDocument({
              sourceKind,
              sourceRaw: text,
              sourceTitle: src.title,
              document: documentCtx,
              userId,
              userEmail: userEmail || '',
            }, onProgress);
            if (rootLogId != null) lastLogId = rootLogId;
            for (const p of proposals) {
              const fannedOut = adaptDocProposalToReviewShape(p, doc.id, doc.sections);
              for (const adapted of fannedOut) allProposals.push(adapted);
            }
          } catch (err) {
            console.error(`[doc-bulk-analyze] analyzeSourceForDocument failed for ${src.source}/${src.id}:`, err);
          }
        }

        const availableReview = {
          id: doc.id,
          title: doc.title,
          sections: doc.sections.map(s => ({
            id: s.id,
            name: s.name,
            subjects: s.subjects.map(sub => ({ id: sub.id, title: sub.title, status: sub.status, situation: sub.situation ?? null })),
          })),
        };

        finishJob(job.id, {
          summary: allProposals.length > 0
            ? `${allProposals.length} sujet(s) extrait(s) et routé(s) dans ${doc.title}.`
            : 'Aucun sujet exploitable.',
          subjects: allProposals,
          availableReviews: [availableReview],
          logId: lastLogId,
        });
      } catch (err) {
        console.error('[doc-bulk-analyze async] error:', err);
        failJob(job.id, err instanceof Error ? err.message : 'Erreur inconnue');
      }
    });
  }));

  // Suggest a name for a new review / section / subject via the
  // suivitess-suggest-name skill. Called from the inline "+ Créer
  // nouvelle X" editor in the bulk-import wizard so the user gets
  // an AI proposal adapted to the source content, with the ability
  // to regenerate by passing a previous suggestion back in.
  router.post('/transcription/suggest-name', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { kind, sourceTitle, rawQuotes, entities, existingSuggestion, parentReviewTitle, parentSectionName, sourceKind } = (req.body || {}) as {
      kind?: 'review' | 'section' | 'subject';
      sourceTitle?: string;
      rawQuotes?: string[];
      entities?: string[];
      existingSuggestion?: string;
      parentReviewTitle?: string;
      parentSectionName?: string;
      sourceKind?: string;
    };
    if (!kind || !['review', 'section', 'subject'].includes(kind)) {
      res.status(400).json({ error: 'kind requis (review / section / subject)' });
      return;
    }
    const { runSkill } = await import('../aiSkills/runSkill.js');
    const ctx = {
      kind,
      sourceTitle: sourceTitle ?? '',
      rawQuotes: Array.isArray(rawQuotes) ? rawQuotes : [],
      entities: Array.isArray(entities) ? entities : [],
      existingSuggestion: existingSuggestion ?? null,
      parentReviewTitle: parentReviewTitle ?? null,
      parentSectionName: parentSectionName ?? null,
    };
    try {
      const run = await runSkill({
        slug: 'suivitess-suggest-name',
        userId,
        userEmail: req.user!.email || '',
        buildContext: () => `## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "name": … }.`,
        inputContent: JSON.stringify(ctx),
        sourceKind: (sourceKind as 'transcript' | 'slack' | 'outlook') ?? 'transcript',
        sourceTitle: sourceTitle ?? 'suggest-name',
        documentId: null,
        parentLogId: null,
        maxTokens: 200,
      });
      const match = run.outputText.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) as { name?: string } : null;
      res.json({ name: parsed?.name ?? '', logId: run.logId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Échec suggestion' });
    }
  }));

  router.post('/transcription/apply-routing', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { sourceId, subjects } = (req.body || {}) as {
      sourceId?: string;
      subjects?: Array<{
        title: string;
        situation?: string;
        status?: string;
        responsibility?: string | null;
        targetReviewId?: string | null;
        newReviewTitle?: string | null;
        targetSectionId?: string | null;
        newSectionName?: string | null;
        /** If set, the route updates this subject instead of creating a new one. */
        subjectAction?: 'new-subject' | 'update-existing-subject';
        targetSubjectId?: string | null;
        updatedSituation?: string | null;
        updatedStatus?: string | null;
        updatedResponsibility?: string | null;
        /** Context used for per-user routing memory embedding (pgvector). */
        rawQuotes?: string[];
        entities?: string[];
        participants?: string[];
        aiProposedReviewId?: string | null;
        aiProposedReviewTitle?: string | null;
      }>;
    };
    if (!Array.isArray(subjects) || subjects.length === 0) {
      res.status(400).json({ error: 'Aucun sujet à appliquer' });
      return;
    }

    // Auto-snapshot every existing review that will be touched, BEFORE applying.
    // Collect unique targetReviewIds, snapshot each once.
    const reviewIdsToSnapshot = new Set<string>();
    for (const s of subjects) {
      if (s.targetReviewId) reviewIdsToSnapshot.add(s.targetReviewId);
    }
    for (const reviewId of reviewIdsToSnapshot) {
      try {
        await db.createSnapshotForDocument(reviewId, 'ai_import');
      } catch { /* non-blocking */ }
    }

    const newReviewByTitle = new Map<string, string>();
    const newSectionByKey = new Map<string, string>(); // key = `${reviewId}::${sectionName}`

    const reviewsCreated: Array<{ id: string; title: string }> = [];
    const sectionsCreated: Array<{ id: string; name: string; reviewId: string }> = [];
    const subjectsCreated: Array<{ id: string; title: string; reviewId: string; sectionId: string }> = [];
    const subjectsUpdated: Array<{ id: string; title: string }> = [];
    const errors: Array<{ title: string; error: string }> = [];

    /** Captures the validated decisions so we can feed the per-user routing
     *  memory (pgvector) fire-and-forget at the end of the request. */
    const memoryEntries: Array<{
      subjectTitle: string;
      subjectSituationExcerpt: string | null;
      rawQuotes: string[];
      entities: string[];
      participants: string[];
      targetDocumentId: string;
      targetSectionId: string | null;
      targetSectionName: string;
      targetSubjectAction: 'new-subject' | 'update-existing-subject';
      aiProposedDocumentId: string | null;
      aiProposedDocumentTitle: string | null;
    }> = [];

    for (const s of subjects) {
      const title = (s.title || '').trim();
      if (!title) continue;

      try {
        // ========== UPDATE PATH ==========
        // If the AI or the user chose "update an existing subject", we call
        // updateSubjectFields on the target id and skip all the review /
        // section creation dance. The backend trusts only existing
        // targetSubjectId — otherwise we fall through to creation.
        if (s.subjectAction === 'update-existing-subject' && s.targetSubjectId) {
          const existing = await db.getSubject(s.targetSubjectId);
          if (existing) {
            const updateFragments: string[] = [];
            const updateValues: (string | number | null)[] = [];
            let idx = 1;
            // Skip the situation update entirely if the payload's
            // append is empty/blank — writing "📝 Ajouté depuis
            // transcription :" with nothing under it was confusing
            // for the user and meant nothing actually got appended.
            if (
              s.updatedSituation !== undefined
              && s.updatedSituation !== null
              && String(s.updatedSituation).trim().length > 0
            ) {
              const currentSituation = existing.situation || '';
              const newSituation = currentSituation
                ? `${currentSituation}\n\n---\n📝 Ajouté depuis transcription :\n${s.updatedSituation}`
                : s.updatedSituation;
              updateFragments.push(`situation = $${idx++}`);
              updateValues.push(newSituation);
            }
            if (s.updatedStatus) {
              updateFragments.push(`status = $${idx++}`);
              updateValues.push(s.updatedStatus);
            }
            if (s.updatedResponsibility !== undefined && s.updatedResponsibility !== null) {
              updateFragments.push(`responsibility = $${idx++}`);
              updateValues.push(s.updatedResponsibility);
            }
            if (updateFragments.length > 0) {
              await db.updateSubjectFields(s.targetSubjectId, updateFragments, updateValues);
            }
            subjectsUpdated.push({ id: s.targetSubjectId, title });

            // Capture for the routing memory — we want to remember that the
            // user chose to ENRICH this existing subject (vs create a new
            // one), so future similar subjects are also routed to enrich.
            try {
              const sec = await db.getSection(existing.section_id);
              if (sec) {
                memoryEntries.push({
                  subjectTitle: title,
                  subjectSituationExcerpt: (s.updatedSituation || existing.situation || '').slice(0, 300),
                  rawQuotes: s.rawQuotes ?? [],
                  entities: s.entities ?? [],
                  participants: s.participants ?? [],
                  targetDocumentId: sec.document_id,
                  targetSectionId: sec.id,
                  targetSectionName: sec.name,
                  targetSubjectAction: 'update-existing-subject',
                  aiProposedDocumentId: s.aiProposedReviewId ?? null,
                  aiProposedDocumentTitle: s.aiProposedReviewTitle ?? null,
                });
              }
            } catch { /* memory is best-effort */ }
            continue;
          }
        }

        // Resolve review (create if needed)
        let reviewId = s.targetReviewId || null;
        if (!reviewId) {
          const newTitle = (s.newReviewTitle || 'Nouvelle review').trim().slice(0, 100);
          const cached = newReviewByTitle.get(newTitle);
          if (cached) {
            reviewId = cached;
          } else {
            const baseSlug = newTitle
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || 'review';
            let id = baseSlug;
            let suffix = 1;
            let created: { id: string } | null = null;
            for (let attempt = 0; attempt < 50; attempt++) {
              try {
                const d = await db.createDocument(id, newTitle, null);
                created = d;
                break;
              } catch (e) {
                const msg = String((e as Error).message || '');
                if (msg.includes('duplicate') || msg.includes('unique')) {
                  suffix++;
                  id = `${baseSlug}-${suffix}`;
                  continue;
                }
                throw e;
              }
            }
            if (!created) {
              errors.push({ title, error: 'Impossible de créer la review' });
              continue;
            }
            try {
              const { ensureOwnership } = await import('../shared/resourceSharing.js');
              await ensureOwnership('suivitess', created.id, userId, 'private');
            } catch { /* best effort */ }
            reviewId = created.id;
            newReviewByTitle.set(newTitle, reviewId);
            reviewsCreated.push({ id: reviewId, title: newTitle });
          }
        }

        // Resolve section
        let sectionId = s.targetSectionId || null;
        if (!sectionId) {
          const rawName = (s.newSectionName || 'Nouveau point').trim().slice(0, 80);
          const normalizedName = rawName.toLowerCase();
          const key = `${reviewId}::${normalizedName}`;
          const cached = newSectionByKey.get(key);
          if (cached) {
            sectionId = cached;
          } else {
            // SAFETY NET — the place-in-reviews skill sometimes emits
            // `suggestedNewSectionName` for a section that ALREADY exists
            // in the target review (e.g. "Application" in "Copil ORANGE"
            // with the existing section id in the same input). Before
            // creating a duplicate, scan the live sections of the review
            // and match by name (case-insensitive, trimmed). If a match
            // exists, reuse its id.
            try {
              const existingSectionsRes = await db.pool.query<{ id: string; name: string }>(
                'SELECT id, name FROM suivitess_sections WHERE document_id = $1',
                [reviewId],
              );
              const existing = existingSectionsRes.rows.find(r =>
                r.name.trim().toLowerCase() === normalizedName,
              );
              if (existing) {
                sectionId = existing.id;
                newSectionByKey.set(key, sectionId);
                // Track this as a dedup hit for server-side observability,
                // but NOT as sectionsCreated — nothing new landed in the DB.
                console.log(`[apply-routing] dedup hit : reuse existing section "${existing.name}" (${existing.id}) in ${reviewId} instead of creating duplicate "${rawName}"`);
              }
            } catch { /* best effort — fall through to create */ }

            if (!sectionId) {
              const section = await db.createSection(reviewId, rawName);
              sectionId = section.id;
              newSectionByKey.set(key, sectionId);
              sectionsCreated.push({ id: sectionId, name: rawName, reviewId });
            }
          }
        }

        const subject = await db.createSubject(
          sectionId,
          title,
          (s.situation ?? null),
          (s.status || '🔴 à faire'),
          s.responsibility ?? null,
        );
        subjectsCreated.push({ id: subject.id, title, reviewId, sectionId });

        // Capture for the routing memory — a "new-subject" decision here
        // teaches the model to create rather than enrich for similar
        // incoming subjects.
        const sectionName = sectionsCreated.find(x => x.id === sectionId)?.name
          || (s.newSectionName?.trim() || '').slice(0, 80)
          || 'Section';
        memoryEntries.push({
          subjectTitle: title,
          subjectSituationExcerpt: (s.situation ?? '').slice(0, 300),
          rawQuotes: s.rawQuotes ?? [],
          entities: s.entities ?? [],
          participants: s.participants ?? [],
          targetDocumentId: reviewId,
          targetSectionId: sectionId,
          targetSectionName: sectionName,
          targetSubjectAction: 'new-subject',
          aiProposedDocumentId: s.aiProposedReviewId ?? null,
          aiProposedDocumentTitle: s.aiProposedReviewTitle ?? null,
        });
      } catch (err) {
        errors.push({ title, error: (err as Error).message || 'Échec' });
      }
    }

    // Fire-and-forget : feed the routing memory AFTER the response is sent.
    // The user doesn't wait on embedding latency, and if the embedding
    // provider is down, the import still succeeds.
    if (memoryEntries.length > 0) {
      setImmediate(async () => {
        try {
          const { storeDecision } = await import('./routingMemoryService.js');
          // Look up document titles once — we store them denormalized so
          // the memory survives review renames.
          const docTitleCache = new Map<string, string>();
          for (const entry of memoryEntries) {
            let docTitle = docTitleCache.get(entry.targetDocumentId);
            if (!docTitle) {
              try {
                const q = await db.pool.query<{ title: string }>(
                  'SELECT title FROM suivitess_documents WHERE id = $1',
                  [entry.targetDocumentId],
                );
                docTitle = q.rows[0]?.title ?? entry.targetDocumentId;
                docTitleCache.set(entry.targetDocumentId, docTitle);
              } catch { docTitle = entry.targetDocumentId; }
            }
            await storeDecision({
              userId,
              subjectTitle: entry.subjectTitle,
              subjectSituationExcerpt: entry.subjectSituationExcerpt,
              rawQuotes: entry.rawQuotes,
              entities: entry.entities,
              participants: entry.participants,
              targetDocumentId: entry.targetDocumentId,
              targetDocumentTitle: docTitle,
              targetSectionId: entry.targetSectionId,
              targetSectionName: entry.targetSectionName,
              targetSubjectAction: entry.targetSubjectAction,
              aiProposedDocumentId: entry.aiProposedDocumentId,
              aiProposedDocumentTitle: entry.aiProposedDocumentTitle,
            });
          }
          // eslint-disable-next-line no-console
          console.log(`[SuiVitess routing-memory] stored ${memoryEntries.length} decision(s) for user ${userId}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[SuiVitess routing-memory] batch store failed:', err);
        }
      });
    }

    // Mark the source as imported so it does not appear in bulk-sources again.
    if (sourceId && subjectsCreated.length > 0) {
      try {
        const firstReview = subjectsCreated[0].reviewId;
        await db.pool.query(
          `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [firstReview, sourceId, 'bulk-router', ''],
        );
      } catch { /* ignore — best effort */ }
    }

    res.json({
      reviewsCreated,
      sectionsCreated,
      subjectsCreated,
      subjectsUpdated,
      errors,
    });
  }));

  return router;
}
