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

export function createRoutes(): Router {
  const router = Router();

  router.use(authMiddleware);

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

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const aiResponse = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Reformule ce sujet de suivi de réunion pour qu'il soit plus clair, structuré et professionnel.

Titre : ${subject.title}
État de la situation : ${subject.situation || '(vide)'}
Responsable : ${subject.responsibility || 'Non assigné'}
Statut : ${subject.status}

Retourne UNIQUEMENT un JSON :
{
  "title": "Titre reformulé (concis, max 100 caractères)",
  "situation": "Situation reformulée (bullet points, structurée, factuelle)"
}

Garde le sens original, améliore la clarté et la structure. Conserve EXACTEMENT le même format que l'original (si c'est des bullet points avec •, garde des •, si c'est du texte libre, garde du texte libre). Ne change pas le fond, seulement la forme. N'ajoute PAS de bullet points si l'original n'en a pas.`,
      }],
    });

    const text = aiResponse.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('');
    let result: { title?: string; situation?: string } = {};
    try {
      let json = text.trim();
      if (json.startsWith('```json')) json = json.slice(7);
      if (json.startsWith('```')) json = json.slice(3);
      if (json.endsWith('```')) json = json.slice(0, -3);
      result = JSON.parse(json.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    }

    res.json({
      title: result.title || subject.title,
      situation: result.situation || subject.situation,
    });
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

    const aiResponse = await client.messages.create({
      model,
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `${templatePrompts[template] || templatePrompts.listing}

Document : "${doc.title}"
${content}

Retourne UNIQUEMENT le corps de l'email (pas d'objet, pas de signature). En français.`,
      }],
    });

    const emailBody = aiResponse.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('');

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

  // Record that a call has been imported into a document
  router.post('/documents/:docId/transcript-imports', asyncHandler(async (req, res) => {
    const { callId, provider, callTitle } = req.body;
    if (!callId || !provider) { res.status(400).json({ error: 'callId + provider requis' }); return; }
    await db.pool.query(
      `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [req.params.docId, callId, provider, callTitle || null]
    );
    res.json({ success: true });
  }));

  // Get list of already-imported call IDs for a document
  router.get('/documents/:docId/transcript-imports', asyncHandler(async (req, res) => {
    const result = await db.pool.query(
      'SELECT call_id, provider, call_title, imported_at FROM suivitess_transcript_imports WHERE document_id = $1 ORDER BY imported_at DESC',
      [req.params.docId]
    );
    res.json(result.rows.map((r: Record<string, unknown>) => ({
      callId: r.call_id as string,
      provider: r.provider as string,
      callTitle: r.call_title as string,
      importedAt: (r.imported_at as Date).toISOString(),
    })));
  }));

  // List recent emails from Outlook or Gmail (via OAuth)
  router.get('/email/list', asyncHandler(async (req, res) => {
    const provider = (req.query.provider as string) || 'outlook';
    const days = parseInt(req.query.days as string) || 7;

    try {
      if (provider === 'outlook') {
        const { listOutlookEmails } = await import('./emailService.js');
        const emails = await listOutlookEmails(req.user!.id, days);
        res.json(emails);
      } else if (provider === 'gmail') {
        const { listGmailEmails } = await import('./emailService.js');
        const emails = await listGmailEmails(req.user!.id, days);
        res.json(emails);
      } else {
        res.status(400).json({ error: `Provider email non supporte: ${provider}` });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      res.status(400).json({ error: message });
    }
  }));

  // Get email body
  router.get('/email/body/:messageId', asyncHandler(async (req, res) => {
    const provider = (req.query.provider as string) || 'outlook';
    const { messageId } = req.params;

    try {
      if (provider === 'outlook') {
        const { getOutlookEmailBody } = await import('./emailService.js');
        const body = await getOutlookEmailBody(req.user!.id, messageId);
        res.json({ body });
      } else if (provider === 'gmail') {
        const { getGmailEmailBody } = await import('./emailService.js');
        const body = await getGmailEmailBody(req.user!.id, messageId);
        res.json({ body });
      } else {
        res.status(400).json({ error: `Provider email non supporte: ${provider}` });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      res.status(400).json({ error: message });
    }
  }));

  // List recent calls from a transcription provider
  router.get('/transcription/calls', asyncHandler(async (req, res) => {
    const provider = (req.query.provider as string) || 'fathom';
    const days = parseInt(req.query.days as string) || 30;

    if (provider === 'fathom') {
      const { listFathomCalls } = await import('./fathomService.js');
      const calls = await listFathomCalls(req.user!.id, days);
      res.json(calls);
    } else if (provider === 'otter') {
      const { listOtterCalls } = await import('./otterService.js');
      const calls = await listOtterCalls(req.user!.id, days);
      res.json(calls);
    } else {
      res.status(400).json({ error: `Provider de transcription non supporté: ${provider}` });
    }
  }));

  // Import a call transcript into a SuiviTess document section.
  // Provider-agnostic — fetches transcript from the configured provider,
  // then creates a section + subjects in the target document.
  router.post('/documents/:docId/transcript-import', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { callId, callTitle, provider: providerParam, useAI, aiProvider: aiProviderParam } = req.body;
    const provider = providerParam || 'fathom';

    if (!callId) {
      res.status(400).json({ error: 'callId est requis' });
      return;
    }

    // Fetch the transcript from the provider
    let transcript: Array<{ speaker: string; text: string; timestamp?: number }> = [];

    if (provider === 'fathom') {
      const { getFathomTranscript } = await import('./fathomService.js');
      transcript = await getFathomTranscript(req.user!.id, callId);
    } else if (provider === 'otter') {
      const { getOtterTranscript } = await import('./otterService.js');
      transcript = await getOtterTranscript(req.user!.id, callId);
    } else {
      res.status(400).json({ error: `Provider non supporté: ${provider}` });
      return;
    }

    if (transcript.length === 0) {
      res.status(400).json({ error: 'Transcription vide' });
      return;
    }

    // Build full transcript text
    const transcriptText = transcript.map(e => `[${e.speaker}]: ${e.text}`).join('\n');

    // Create a section named after the provider + call title
    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
    const sectionName = `${providerLabel} — ${callTitle || 'Call'}`;
    const section = await db.createSection(docId, sectionName);

    if (useAI) {
      // ── AI-powered extraction: send transcript to LLM to extract structured subjects ──
      try {
        const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
        try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'transcript_analysis'); }
        catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

        const { getAnthropicClient } = await import('../connectors/aiProvider.js');
        const { client, model } = await getAnthropicClient(req.user!.id);

        const aiResponse = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `Tu es un assistant de suivi de réunion. Analyse cette transcription et extrais les sujets clés discutés.

Pour chaque sujet, retourne :
- "title": un titre court et clair (max 100 caractères)
- "situation": un résumé de ce qui a été dit sur ce sujet (2-3 phrases max)
- "responsibility": la personne responsable si mentionnée, sinon null
- "status": "🔴 à faire" si c'est une action, "🟡 en cours" si c'est un sujet ouvert, "🟢 fait" si c'est résolu

Retourne UNIQUEMENT un tableau JSON, sans markdown ni explication.
Exemple: [{"title":"...", "situation":"...", "responsibility":"...", "status":"🔴 à faire"}]

Maximum 15 sujets, priorise les plus importants.

Transcription:
${transcriptText.slice(0, 30000)}`,
          }],
        });

        const responseText = aiResponse.content
          .filter(c => c.type === 'text')
          .map(c => (c as { type: 'text'; text: string }).text)
          .join('');

        // Parse JSON
        let subjects: Array<{ title: string; situation: string; responsibility?: string | null; status?: string }> = [];
        try {
          let jsonText = responseText.trim();
          if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
          if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
          if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
          subjects = JSON.parse(jsonText.trim());
        } catch {
          // Fallback: try to extract array from response
          const match = responseText.match(/\[[\s\S]*\]/);
          if (match) subjects = JSON.parse(match[0]);
        }

        // Create subjects from AI analysis
        for (let i = 0; i < Math.min(subjects.length, 15); i++) {
          const s = subjects[i];
          await db.createSubject(
            section.id,
            s.title || 'Sujet sans titre',
            s.situation || '',
            s.status || '🟡 en cours',
            s.responsibility || null,
          );
        }

        res.json({
          success: true,
          sectionId: section.id,
          sectionName,
          subjectCount: subjects.length,
          mode: 'ai',
        });
        return;
      } catch (err) {
        // AI failed — fall through to raw import
        console.error('[SuiviTess] AI transcript analysis failed:', err);
      }
    }

    // ── Raw import: group by speaker blocks (fallback or when useAI=false) ──
    const blocks: Array<{ speaker: string; texts: string[] }> = [];
    let current: { speaker: string; texts: string[] } | null = null;

    for (const entry of transcript) {
      if (current && current.speaker === entry.speaker) {
        current.texts.push(entry.text);
      } else {
        if (current) blocks.push(current);
        current = { speaker: entry.speaker, texts: [entry.text] };
      }
    }
    if (current) blocks.push(current);

    const maxBlocks = Math.min(blocks.length, 50);
    for (let i = 0; i < maxBlocks; i++) {
      const block = blocks[i];
      const fullText = block.texts.join(' ');
      const title = fullText.slice(0, 200);
      await db.createSubject(
        section.id,
        `[${block.speaker}] ${title}${fullText.length > 200 ? '...' : ''}`,
        fullText,
        '🟡 en cours',
        block.speaker,
      );
    }

    res.json({
      success: true,
      sectionId: section.id,
      sectionName,
      subjectCount: maxBlocks,
      mode: 'raw',
    });
  }));

  // ── Step 1: AI proposes changes (preview, nothing applied yet) ──
  router.post('/documents/:docId/transcript-propose', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { sectionId } = req.body;

    if (!sectionId) { res.status(400).json({ error: 'sectionId est requis' }); return; }

    const doc = await db.getDocumentWithSections(docId);
    if (!doc) { res.status(404).json({ error: 'Document non trouvé' }); return; }

    const sourceSection = doc.sections.find(s => s.id === sectionId);
    if (!sourceSection) { res.status(404).json({ error: 'Section source non trouvée' }); return; }

    const existingSections = doc.sections.filter(s => s.id !== sectionId);

    // Build context with section IDs so the AI can reference them
    const existingContext = existingSections.map(s => {
      const subjectsText = s.subjects.map(sub =>
        `  - [id:${sub.id}] [${sub.status}] "${sub.title}" (responsable: ${sub.responsibility || '-'})\n    Situation: ${sub.situation || '(vide)'}`
      ).join('\n');
      return `Section [id:${s.id}] "${s.name}":\n${subjectsText || '  (vide)'}`;
    }).join('\n\n');

    const transcriptionSubjects = sourceSection.subjects.map(sub =>
      `- "${sub.title}"\n  ${sub.situation || ''}`
    ).join('\n');

    const { deductCredits: deductCr, InsufficientCreditsError: InsCrErr } = await import('../connectors/creditService.js');
    try { await deductCr(req.user!.id, req.user!.isAdmin, 'suivitess', 'transcript_merge'); }
    catch (e) { if (e instanceof InsCrErr) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const aiResponse = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Tu es un assistant de suivi de réunion. Analyse la transcription et propose des changements à apporter au document existant.

## Document existant (avec IDs) :
${existingContext || '(aucun sujet existant)'}

## Sujets extraits de la transcription :
${transcriptionSubjects}

## Types d'actions possibles :

1. "enrich" — Enrichir l'état de la situation d'un sujet existant. N'écrase PAS l'existant, AJOUTE du texte.
2. "create_subject" — Créer un nouveau sujet dans une section existante.
3. "create_section" — Créer une nouvelle section avec ses sujets (si le thème ne correspond à aucune section existante).

## Règles :
- Pour "enrich" : retourne le texte à AJOUTER (pas la situation complète)
- Pour "create_subject" : indique dans quelle section existante le placer (via sectionId)
- Pour "create_section" : inclus les sujets à créer dedans
- Ignore les sujets triviaux, bavardage, ou hors-sujet
- Maximum 10 propositions

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "action": "enrich",
    "subjectId": "uuid",
    "subjectTitle": "titre du sujet (pour affichage)",
    "sectionName": "nom de la section (pour affichage)",
    "appendText": "Nouveau texte à ajouter à la situation existante",
    "reason": "Justification courte"
  },
  {
    "action": "create_subject",
    "sectionId": "uuid",
    "sectionName": "nom de la section (pour affichage)",
    "title": "Titre du nouveau sujet",
    "situation": "Description...",
    "responsibility": "Responsable ou null",
    "status": "🔴 à faire",
    "reason": "Justification"
  },
  {
    "action": "create_section",
    "sectionName": "Nom de la nouvelle section",
    "subjects": [
      { "title": "...", "situation": "...", "responsibility": null, "status": "🔴 à faire" }
    ],
    "reason": "Justification"
  }
]`,
      }],
    });

    const responseText = aiResponse.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');

    let proposals: Array<Record<string, unknown>> = [];
    try {
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
      if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
      if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
      proposals = JSON.parse(jsonText.trim());
    } catch {
      const match = responseText.match(/\[[\s\S]*\]/);
      if (match) proposals = JSON.parse(match[0]);
    }

    // Add an index to each proposal for selection
    const indexed = proposals.map((p, i) => ({ ...p, id: i }));

    res.json({ proposals: indexed });
  }));

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
  router.post('/documents/:docId/transcript-analyze-and-propose', asyncHandler(async (req, res) => {
    const { docId } = req.params;
    const { callId, callTitle, provider: providerParam } = req.body;
    const provider = providerParam || 'fathom';

    if (!callId) { res.status(400).json({ error: 'callId est requis' }); return; }

    // 1. Fetch transcript
    let transcript: Array<{ speaker: string; text: string; timestamp?: number }> = [];
    if (provider === 'fathom') {
      const { getFathomTranscript } = await import('./fathomService.js');
      transcript = await getFathomTranscript(req.user!.id, callId);
    } else if (provider === 'otter') {
      const { getOtterTranscript } = await import('./otterService.js');
      transcript = await getOtterTranscript(req.user!.id, callId);
    } else {
      res.status(400).json({ error: `Provider non supporté: ${provider}` }); return;
    }

    if (transcript.length === 0) { res.status(400).json({ error: 'Transcription vide' }); return; }

    // 2. Fetch existing document
    const doc = await db.getDocumentWithSections(docId);
    if (!doc) { res.status(404).json({ error: 'Document non trouvé' }); return; }

    const transcriptText = transcript.map(e => `[${e.speaker}]: ${e.text}`).join('\n');

    const existingContext = doc.sections.map(s => {
      const subjectsText = s.subjects.map(sub =>
        `  - [id:${sub.id}] [${sub.status}] "${sub.title}" (responsable: ${sub.responsibility || '-'})\n    Situation: ${sub.situation || '(vide)'}`
      ).join('\n');
      return `Section [id:${s.id}] "${s.name}":\n${subjectsText || '  (vide)'}`;
    }).join('\n\n');

    // 3. AI analysis — credit check
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'suivitess', 'transcript_analysis'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const aiResponse = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Tu es un assistant de suivi de réunion. Analyse cette transcription et propose des modifications au document de suivi existant.

## Document existant (avec IDs) :
${existingContext || '(aucun sujet existant)'}

## Transcription du call "${callTitle || 'Call'}" :
${transcriptText.slice(0, 30000)}

## Types d'actions possibles :

1. "enrich" — Enrichir l'état de la situation d'un sujet existant. N'écrase PAS l'existant, AJOUTE du texte.
2. "create_subject" — Créer un nouveau sujet dans une section existante.
3. "create_section" — Créer une nouvelle section avec ses sujets (si le thème ne correspond à aucune section existante).

## Règles :
- Pour "enrich" : retourne le texte à AJOUTER (pas la situation complète)
- Pour "create_subject" : indique dans quelle section existante le placer (via sectionId)
- Pour "create_section" : inclus les sujets à créer dedans
- Ignore les bavardages, hors-sujet, salutations
- Maximum 10 propositions, priorise les plus importantes

Retourne UNIQUEMENT un tableau JSON :
[
  {
    "action": "enrich",
    "subjectId": "uuid",
    "subjectTitle": "titre du sujet (pour affichage)",
    "sectionName": "nom de la section (pour affichage)",
    "appendText": "Nouveau texte à ajouter",
    "reason": "Justification courte"
  },
  {
    "action": "create_subject",
    "sectionId": "uuid",
    "sectionName": "nom de la section (pour affichage)",
    "title": "Titre du nouveau sujet",
    "situation": "Description...",
    "responsibility": "Responsable ou null",
    "status": "🔴 à faire",
    "reason": "Justification"
  },
  {
    "action": "create_section",
    "sectionName": "Nom de la nouvelle section",
    "subjects": [
      { "title": "...", "situation": "...", "responsibility": null, "status": "🔴 à faire" }
    ],
    "reason": "Justification"
  }
]`,
      }],
    });

    const responseText = aiResponse.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');

    let proposals: Array<Record<string, unknown>> = [];
    try {
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7);
      if (jsonText.startsWith('```')) jsonText = jsonText.slice(3);
      if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3);
      proposals = JSON.parse(jsonText.trim());
    } catch {
      const match = responseText.match(/\[[\s\S]*\]/);
      if (match) proposals = JSON.parse(match[0]);
    }

    res.json({ proposals: proposals.map((p, i) => ({ ...p, id: i })) });
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

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const aiResponse = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Tu es un assistant de suivi de projet. Analyse ces ${sourceLabel} et propose des modifications au document de suivi existant.

## Document existant :
${existingContext || '(Document vide)'}

## Contenu a analyser (${sourceLabel}) :
${filteredContent.slice(0, 30000)}

## Regles :
- Propose max 10 actions
- Ignore les messages triviaux (salutations, signatures)
- Types d'actions possibles :
  1. "enrich" : enrichir un sujet existant avec de nouvelles informations
  2. "create_subject" : creer un nouveau sujet dans une section existante
  3. "create_section" : creer une nouvelle section avec ses sujets

Reponds UNIQUEMENT avec un JSON valide :
{
  "proposals": [
    { "action": "enrich", "subjectId": "uuid", "subjectTitle": "titre actuel", "sectionName": "section", "appendText": "texte a ajouter", "reason": "pourquoi" },
    { "action": "create_subject", "sectionId": "uuid", "sectionName": "section", "title": "titre", "situation": "description", "responsibility": null, "status": "a faire", "reason": "pourquoi" },
    { "action": "create_section", "sectionName": "nom section", "subjects": [{ "title": "...", "situation": "...", "status": "..." }], "reason": "pourquoi" }
  ]
}`,
      }],
    });

    const text = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
    let proposals: Array<Record<string, unknown>> = [];
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        proposals = parsed.proposals || [];
      }
    } catch { /* parse error */ }

    res.json({ proposals: proposals.map((p, i) => ({ ...p, id: i })), skipped });
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

  // ==================== Bulk transcription import (list-level) ====================

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

    // Exclude items already imported into any of this user's documents.
    try {
      const { rows } = await db.pool.query(
        `SELECT call_id FROM suivitess_transcript_imports
         WHERE document_id IN (SELECT id FROM suivitess_documents WHERE owner_id = $1 OR owner_id IS NULL)`,
        [userId],
      );
      const imported = new Set(rows.map(r => r.call_id as string));
      for (let i = items.length - 1; i >= 0; i--) {
        if (imported.has(items[i].id)) items.splice(i, 1);
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

  // POST /transcription/route-suggestions
  // body: { items: SourceItem[] }
  // Fetches the user's existing reviews and asks the AI to decide where
  // each item should be imported. Returns { summary, suggestions }.
  router.post('/transcription/route-suggestions', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { items } = req.body as { items?: Array<{
      id: string; provider: string; title: string; date?: string | null;
      participants?: string[]; preview?: string;
    }> };
    if (!Array.isArray(items) || items.length === 0) {
      res.json({ summary: 'Aucun item.', suggestions: [] });
      return;
    }

    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(userId, req.user!.isAdmin, 'suivitess', 'routing_analysis'); }
    catch (e) {
      if (e instanceof InsufficientCreditsError) {
        res.status(402).json({ error: 'INSUFFICIENT_CREDITS', required: e.required, available: e.available });
        return;
      }
      throw e;
    }

    const existingDocs = await db.getAllDocuments(userId, req.user!.isAdmin);
    const existingReviews = existingDocs.map((d: { id: string; title: string; description?: string | null }) => ({
      id: d.id,
      title: d.title,
      description: d.description ?? null,
    }));

    const { suggestRouting } = await import('./transcriptionRoutingService.js');
    try {
      const safeItems = items.slice(0, 50).map(it => ({
        id: String(it.id),
        provider: (['fathom', 'otter', 'gmail', 'outlook'].includes(it.provider) ? it.provider : 'fathom') as 'fathom' | 'otter' | 'gmail' | 'outlook',
        title: String(it.title || ''),
        date: it.date ?? null,
        participants: it.participants,
        preview: it.preview,
      }));
      const result = await suggestRouting(userId, safeItems, existingReviews);
      res.json(result);
    } catch (err) {
      console.error('[SuiviTess routing] error:', err);
      res.status(500).json({ error: (err as Error).message || 'Analyse échouée' });
    }
  }));

  return router;
}
