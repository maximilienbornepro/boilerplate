import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;

let pool: pg.Pool;
export { pool };

// ==================== TYPES ====================

interface Section {
  id: string;
  document_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface Subject {
  id: string;
  section_id: string;
  title: string;
  situation: string | null;
  status: string;
  responsibility: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface SectionWithSubjects extends Section {
  subjects: Subject[];
}

export interface DocumentWithSections {
  id: string;
  title: string;
  sections: SectionWithSubjects[];
  updated_at: string;
}

// ==================== INITIALIZATION ====================

export async function initDb(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  const client = await pool.connect();
  try {
    // Create extension for UUID
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // Create documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suivitess_documents (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Auto-migration: add description column for existing installs
    await client.query(`ALTER TABLE suivitess_documents ADD COLUMN IF NOT EXISTS description TEXT`);

    // Create sections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suivitess_sections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create subjects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suivitess_subjects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        section_id UUID NOT NULL REFERENCES suivitess_sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        situation TEXT,
        status VARCHAR(50) DEFAULT '🔴 à faire',
        responsibility TEXT,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create snapshots table (JSON format)
    await client.query(`
      CREATE TABLE IF NOT EXISTS suivitess_snapshots (
        id SERIAL PRIMARY KEY,
        document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
        snapshot_data JSONB NOT NULL,
        type VARCHAR(20) DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_suivitess_sections_document ON suivitess_sections(document_id);
      CREATE INDEX IF NOT EXISTS idx_suivitess_subjects_section ON suivitess_subjects(section_id);
      CREATE INDEX IF NOT EXISTS idx_suivitess_snapshots_document ON suivitess_snapshots(document_id);
    `);

  } finally {
    client.release();
  }

  // Migration: add owner_id (rétro-compat: nullable, backfill to admin)
  try {
    await pool.query('ALTER TABLE suivitess_documents ADD COLUMN IF NOT EXISTS owner_id INTEGER');
    await pool.query('UPDATE suivitess_documents SET owner_id = 1 WHERE owner_id IS NULL');
  } catch { /* already done */ }

  // Backfill resource_sharing entries for existing documents
  try {
    const { ensureOwnership } = await import('../shared/resourceSharing.js');
    const docs = await pool.query('SELECT id FROM suivitess_documents');
    for (const d of docs.rows) {
      await ensureOwnership('suivitess', d.id, 1, 'public');
    }
  } catch { /* sharing table may not exist yet */ }

  console.log('[SuiVitess] Module initialized');
}

// ==================== HELPERS ====================

export async function getDocumentWithSections(docId: string): Promise<DocumentWithSections | null> {
  // Get document
  const docResult = await pool.query(
    'SELECT id, title, updated_at FROM suivitess_documents WHERE id = $1',
    [docId]
  );

  if (docResult.rows.length === 0) return null;

  const doc = docResult.rows[0];

  // Get sections with subjects
  const sectionsResult = await pool.query(
    'SELECT * FROM suivitess_sections WHERE document_id = $1 ORDER BY position',
    [docId]
  );

  const sections: SectionWithSubjects[] = [];

  for (const section of sectionsResult.rows) {
    const subjectsResult = await pool.query(
      'SELECT * FROM suivitess_subjects WHERE section_id = $1 ORDER BY position',
      [section.id]
    );

    sections.push({
      ...section,
      subjects: subjectsResult.rows,
    });
  }

  return {
    id: doc.id,
    title: doc.title,
    sections,
    updated_at: doc.updated_at,
  };
}

export async function createSnapshotForDocument(documentId: string): Promise<void> {
  const doc = await getDocumentWithSections(documentId);
  if (!doc) return;

  await pool.query(
    'INSERT INTO suivitess_snapshots (document_id, snapshot_data) VALUES ($1, $2)',
    [documentId, JSON.stringify(doc)]
  );
}

// ==================== SEARCH ====================

export interface SubjectSearchResult {
  id: string;
  title: string;
  status: string;
  section_name: string;
  document_id: string;
  document_title: string;
}

export async function searchSubjects(q: string): Promise<SubjectSearchResult[]> {
  const result = await pool.query(
    `SELECT
      sub.id,
      sub.title,
      sub.status,
      sec.name AS section_name,
      doc.id   AS document_id,
      doc.title AS document_title
     FROM suivitess_subjects sub
     JOIN suivitess_sections  sec ON sub.section_id = sec.id
     JOIN suivitess_documents doc ON sec.document_id = doc.id
     WHERE sub.title ILIKE $1
     ORDER BY doc.title, sec.name, sub.title
     LIMIT 20`,
    [`%${q}%`]
  );
  return result.rows;
}

// ==================== DOCUMENT QUERIES ====================

export async function getAllDocuments(userId?: number, isAdmin?: boolean) {
  if (!userId || isAdmin) {
    const result = await pool.query('SELECT id, title, description FROM suivitess_documents ORDER BY title');
    return result.rows;
  }
  const result = await pool.query(
    `SELECT d.id, d.title, d.description FROM suivitess_documents d
     LEFT JOIN resource_sharing rs ON rs.resource_type = 'suivitess' AND rs.resource_id = d.id
     LEFT JOIN resource_shares rsh ON rsh.resource_type = 'suivitess' AND rsh.resource_id = d.id AND rsh.shared_with_user_id = $1
     WHERE rs.id IS NULL OR rs.owner_id = $1 OR rs.visibility = 'public' OR rsh.id IS NOT NULL
     ORDER BY d.title`,
    [userId]
  );
  return result.rows;
}

export async function createDocument(id: string, title: string, description?: string | null) {
  const result = await pool.query(
    'INSERT INTO suivitess_documents (id, title, description) VALUES ($1, $2, $3) RETURNING id, title, description',
    [id, title, description ?? null]
  );
  return result.rows[0];
}

export async function updateDocument(docId: string, data: { title?: string; description?: string | null }) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (data.title !== undefined) { fields.push(`title = $${idx++}`); values.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  values.push(docId);
  const result = await pool.query(
    `UPDATE suivitess_documents SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, title, description`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteDocument(docId: string) {
  const result = await pool.query('DELETE FROM suivitess_documents WHERE id = $1 RETURNING id', [docId]);
  return result.rowCount;
}

// ==================== SECTION QUERIES ====================

export async function createSection(docId: string, name: string) {
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM suivitess_sections WHERE document_id = $1',
    [docId]
  );
  const position = maxPos.rows[0].next_pos;

  const result = await pool.query(
    'INSERT INTO suivitess_sections (document_id, name, position) VALUES ($1, $2, $3) RETURNING *',
    [docId, name, position]
  );

  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [docId]);

  return result.rows[0];
}

export async function getSection(sectionId: string) {
  const result = await pool.query('SELECT * FROM suivitess_sections WHERE id = $1', [sectionId]);
  return result.rows[0] || null;
}

export async function updateSectionName(sectionId: string, name: string) {
  await pool.query(
    'UPDATE suivitess_sections SET name = $1, updated_at = NOW() WHERE id = $2',
    [name, sectionId]
  );
}

export async function updateSectionPosition(docId: string, sectionId: string, oldPos: number, newPos: number) {
  if (newPos > oldPos) {
    await pool.query(`
      UPDATE suivitess_sections SET position = position - 1, updated_at = NOW()
      WHERE document_id = $1 AND position > $2 AND position <= $3
    `, [docId, oldPos, newPos]);
  } else {
    await pool.query(`
      UPDATE suivitess_sections SET position = position + 1, updated_at = NOW()
      WHERE document_id = $1 AND position >= $2 AND position < $3
    `, [docId, newPos, oldPos]);
  }

  await pool.query(
    'UPDATE suivitess_sections SET position = $1, updated_at = NOW() WHERE id = $2',
    [newPos, sectionId]
  );
}

export async function deleteSection(sectionId: string) {
  const section = await pool.query('SELECT * FROM suivitess_sections WHERE id = $1', [sectionId]);
  if (section.rows.length === 0) return null;

  const { document_id, position } = section.rows[0];

  const subjectCount = await pool.query(
    'SELECT COUNT(*) FROM suivitess_subjects WHERE section_id = $1',
    [sectionId]
  );

  await pool.query('DELETE FROM suivitess_sections WHERE id = $1', [sectionId]);

  await pool.query(`
    UPDATE suivitess_sections SET position = position - 1, updated_at = NOW()
    WHERE document_id = $1 AND position > $2
  `, [document_id, position]);

  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [document_id]);

  return { deletedSubjects: parseInt(subjectCount.rows[0].count) };
}

export async function reorderSections(docId: string, sectionIds: string[]) {
  for (let i = 0; i < sectionIds.length; i++) {
    await pool.query(
      'UPDATE suivitess_sections SET position = $1, updated_at = NOW() WHERE id = $2 AND document_id = $3',
      [i, sectionIds[i], docId]
    );
  }
  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [docId]);
}

// ==================== SUBJECT QUERIES ====================

export async function getSectionDocId(sectionId: string): Promise<string | null> {
  const result = await pool.query('SELECT document_id FROM suivitess_sections WHERE id = $1', [sectionId]);
  return result.rows[0]?.document_id || null;
}

export async function createSubject(sectionId: string, title: string, situation: string | null, status: string, responsibility: string | null) {
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM suivitess_subjects WHERE section_id = $1',
    [sectionId]
  );
  const position = maxPos.rows[0].next_pos;

  const result = await pool.query(
    `INSERT INTO suivitess_subjects (section_id, title, situation, status, responsibility, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sectionId, title, situation, status, responsibility, position]
  );

  const docId = await getSectionDocId(sectionId);
  if (docId) {
    await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [docId]);
  }

  return result.rows[0];
}

export async function getSubjectWithDocId(subjectId: string) {
  const result = await pool.query(
    `SELECT s.*, sec.document_id FROM suivitess_subjects s
     JOIN suivitess_sections sec ON s.section_id = sec.id
     WHERE s.id = $1`,
    [subjectId]
  );
  return result.rows[0] || null;
}

export async function updateSubjectFields(subjectId: string, updates: string[], values: (string | number | null)[]) {
  if (updates.length === 0) return;
  updates.push('updated_at = NOW()');
  const paramCount = values.length + 1;
  values.push(subjectId);
  await pool.query(
    `UPDATE suivitess_subjects SET ${updates.join(', ')} WHERE id = $${paramCount}`,
    values
  );
}

export async function moveSubjectToSection(subjectId: string, oldSectionId: string, oldPosition: number, newSectionId: string, newPosition: number) {
  // Close gap in old section
  await pool.query(`
    UPDATE suivitess_subjects SET position = position - 1, updated_at = NOW()
    WHERE section_id = $1 AND position > $2
  `, [oldSectionId, oldPosition]);

  // Make space in target section
  await pool.query(`
    UPDATE suivitess_subjects SET position = position + 1, updated_at = NOW()
    WHERE section_id = $1 AND position >= $2
  `, [newSectionId, newPosition]);
}

export async function getNextSubjectPosition(sectionId: string): Promise<number> {
  const result = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM suivitess_subjects WHERE section_id = $1',
    [sectionId]
  );
  return result.rows[0].next_pos;
}

export async function reorderSubjectPositions(sectionId: string, oldPos: number, newPos: number) {
  if (newPos > oldPos) {
    await pool.query(`
      UPDATE suivitess_subjects SET position = position - 1, updated_at = NOW()
      WHERE section_id = $1 AND position > $2 AND position <= $3
    `, [sectionId, oldPos, newPos]);
  } else {
    await pool.query(`
      UPDATE suivitess_subjects SET position = position + 1, updated_at = NOW()
      WHERE section_id = $1 AND position >= $2 AND position < $3
    `, [sectionId, newPos, oldPos]);
  }
}

export async function getSubject(subjectId: string) {
  const result = await pool.query('SELECT * FROM suivitess_subjects WHERE id = $1', [subjectId]);
  return result.rows[0] || null;
}

export async function deleteSubject(subjectId: string) {
  const subject = await pool.query(
    `SELECT s.*, sec.document_id FROM suivitess_subjects s
     JOIN suivitess_sections sec ON s.section_id = sec.id
     WHERE s.id = $1`,
    [subjectId]
  );
  if (subject.rows.length === 0) return null;

  const { section_id, position, document_id } = subject.rows[0];

  await pool.query('DELETE FROM suivitess_subjects WHERE id = $1', [subjectId]);

  await pool.query(`
    UPDATE suivitess_subjects SET position = position - 1, updated_at = NOW()
    WHERE section_id = $1 AND position > $2
  `, [section_id, position]);

  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [document_id]);

  return { success: true };
}

export async function reorderSubjects(sectionId: string, subjectIds: string[]) {
  const section = await pool.query('SELECT document_id FROM suivitess_sections WHERE id = $1', [sectionId]);
  if (section.rows.length === 0) return null;

  for (let i = 0; i < subjectIds.length; i++) {
    await pool.query(
      'UPDATE suivitess_subjects SET position = $1, updated_at = NOW() WHERE id = $2 AND section_id = $3',
      [i, subjectIds[i], sectionId]
    );
  }

  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [section.rows[0].document_id]);

  return { success: true };
}

export async function updateDocumentTimestamp(docId: string) {
  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [docId]);
}

// ==================== SNAPSHOT QUERIES ====================

export async function getSnapshotHistory(docId: string) {
  const result = await pool.query(
    `SELECT id, type, created_at FROM suivitess_snapshots
     WHERE document_id = $1 ORDER BY created_at DESC`,
    [docId]
  );
  return result.rows;
}

export async function getSnapshot(snapshotId: number) {
  const result = await pool.query(
    'SELECT * FROM suivitess_snapshots WHERE id = $1',
    [snapshotId]
  );
  return result.rows[0] || null;
}

export async function restoreFromSnapshot(docId: string, data: DocumentWithSections) {
  // Delete current sections (cascade deletes subjects)
  await pool.query('DELETE FROM suivitess_sections WHERE document_id = $1', [docId]);

  // Recreate sections and subjects from snapshot
  for (const section of data.sections) {
    const sectionResult = await pool.query(
      'INSERT INTO suivitess_sections (document_id, name, position) VALUES ($1, $2, $3) RETURNING id',
      [docId, section.name, section.position]
    );
    const newSectionId = sectionResult.rows[0].id;

    for (const subject of section.subjects) {
      await pool.query(
        `INSERT INTO suivitess_subjects (section_id, title, situation, status, responsibility, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newSectionId, subject.title, subject.situation, subject.status, subject.responsibility, subject.position]
      );
    }
  }

  await pool.query('UPDATE suivitess_documents SET updated_at = NOW() WHERE id = $1', [docId]);
}

export async function getLatestSnapshot(docId: string) {
  const result = await pool.query(
    `SELECT snapshot_data, created_at FROM suivitess_snapshots
     WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [docId]
  );
  return result.rows[0] || null;
}

export async function verifyTargetSection(sectionId: string, docId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT document_id FROM suivitess_sections WHERE id = $1',
    [sectionId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].document_id === docId;
}

// ==================== RECORDER ====================

export interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface Recording {
  id: number;
  documentId: string;
  meetingUrl: string;
  status: string;
  transcriptJson: CaptionEntry[] | null;
  captionCount: number;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

function formatRecording(row: any): Recording {
  return {
    id: row.id,
    documentId: row.document_id,
    meetingUrl: row.meeting_url,
    status: row.status,
    transcriptJson: row.transcript_json,
    captionCount: row.caption_count,
    error: row.error,
    startedAt: row.started_at?.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createRecording(documentId: string, meetingUrl: string): Promise<Recording> {
  const result = await pool.query(
    `INSERT INTO suivitess_recordings (document_id, meeting_url, status)
     VALUES ($1, $2, 'joining') RETURNING *`,
    [documentId, meetingUrl]
  );
  return formatRecording(result.rows[0]);
}

export async function updateRecordingStatus(id: number, status: string, error: string | null = null): Promise<void> {
  const endedAt = ['done', 'error'].includes(status) ? 'NOW()' : 'NULL';
  await pool.query(
    `UPDATE suivitess_recordings SET status = $1, error = $2, ended_at = ${endedAt === 'NOW()' ? 'NOW()' : 'NULL'} WHERE id = $3`,
    [status, error, id]
  );
}

export async function updateCaptionCount(id: number, count: number): Promise<void> {
  await pool.query('UPDATE suivitess_recordings SET caption_count = $1 WHERE id = $2', [count, id]);
}

export async function saveTranscript(id: number, transcript: CaptionEntry[], captionCount: number): Promise<void> {
  await pool.query(
    `UPDATE suivitess_recordings SET transcript_json = $1, caption_count = $2, ended_at = NOW() WHERE id = $3`,
    [JSON.stringify(transcript), captionCount, id]
  );
}

export async function getRecordingByDocument(documentId: string): Promise<Recording | null> {
  const result = await pool.query(
    `SELECT * FROM suivitess_recordings WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [documentId]
  );
  return result.rows[0] ? formatRecording(result.rows[0]) : null;
}

// ==================== SUGGESTIONS ====================

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

function formatSuggestion(row: any): Suggestion {
  return {
    id: row.id,
    recordingId: row.recording_id,
    documentId: row.document_id,
    type: row.type,
    targetSectionId: row.target_section_id,
    targetSubjectId: row.target_subject_id,
    proposedTitle: row.proposed_title,
    proposedSituation: row.proposed_situation,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createSuggestion(
  recordingId: number,
  documentId: string,
  data: Omit<Suggestion, 'id' | 'recordingId' | 'documentId' | 'status' | 'createdAt'>
): Promise<Suggestion> {
  const result = await pool.query(
    `INSERT INTO suivitess_suggestions
     (recording_id, document_id, type, target_section_id, target_subject_id, proposed_title, proposed_situation, rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      recordingId, documentId, data.type,
      data.targetSectionId ?? null, data.targetSubjectId ?? null,
      data.proposedTitle ?? null, data.proposedSituation ?? null, data.rationale,
    ]
  );
  return formatSuggestion(result.rows[0]);
}

export async function getSuggestions(documentId: string): Promise<Suggestion[]> {
  const result = await pool.query(
    `SELECT * FROM suivitess_suggestions WHERE document_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
    [documentId]
  );
  return result.rows.map(formatSuggestion);
}

export async function updateSuggestionStatus(id: number, status: 'accepted' | 'rejected'): Promise<Suggestion | null> {
  const result = await pool.query(
    `UPDATE suivitess_suggestions SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return result.rows[0] ? formatSuggestion(result.rows[0]) : null;
}
