import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;

let pool: pg.Pool;

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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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

// ==================== DOCUMENT QUERIES ====================

export async function getAllDocuments() {
  const result = await pool.query('SELECT id, title FROM suivitess_documents ORDER BY title');
  return result.rows;
}

export async function createDocument(id: string, title: string) {
  const result = await pool.query(
    'INSERT INTO suivitess_documents (id, title) VALUES ($1, $2) RETURNING id, title',
    [id, title]
  );
  return result.rows[0];
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
