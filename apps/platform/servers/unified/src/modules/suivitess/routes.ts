import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import type { DocumentWithSections } from './dbService.js';

export function createRoutes(): Router {
  const router = Router();

  router.use(authMiddleware);

  // ==================== DOCUMENTS ====================

  // List all documents
  router.get('/documents', asyncHandler(async (_req, res) => {
    const docs = await db.getAllDocuments();
    res.json(docs);
  }));

  // Create document
  router.post('/documents', asyncHandler(async (req, res) => {
    const { title } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    // Generate ID from title (kebab-case)
    const id = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    try {
      const doc = await db.createDocument(id, title.trim());
      console.log('[SuiVitess] Document created:', id);
      res.json(doc);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        res.status(409).json({ error: 'Un document avec ce nom existe déjà' });
        return;
      }
      throw error;
    }
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

  return router;
}
