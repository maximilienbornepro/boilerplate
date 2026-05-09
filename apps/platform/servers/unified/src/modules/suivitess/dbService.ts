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
  /** When non-null, this subject row is rendered in a section that is
   *  NOT its canonical home — it's surfaced via a row in
   *  `suivitess_subject_cross_links`. The frontend uses these fields
   *  to display a "🔗 lié depuis …" badge. The id remains the
   *  canonical subject id, so any PATCH /subjects/:id edits the
   *  original — no special edit path needed. */
  linkedFromSectionId?: string | null;
  linkedFromSectionName?: string | null;
  linkedFromDocumentId?: string | null;
  linkedFromDocumentTitle?: string | null;
  /** UUID of the row in `suivitess_subject_cross_links`. Lets the
   *  frontend remove the link without touching the canonical
   *  subject (DELETE /subject-links/:linkId). */
  linkId?: string | null;
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

  // Migration: flag subjects that do not need a ticket/roadmap action
  // (excluded from future AI ticket-analysis suggestions)
  try {
    await pool.query('ALTER TABLE suivitess_subjects ADD COLUMN IF NOT EXISTS no_action_needed BOOLEAN DEFAULT FALSE');
  } catch { /* already done */ }

  // Backfill resource_sharing entries for existing documents
  try {
    const { ensureOwnership } = await import('../shared/resourceSharing.js');
    const docs = await pool.query('SELECT id FROM suivitess_documents');
    for (const d of docs.rows) {
      await ensureOwnership('suivitess', d.id, 1, 'public');
    }
  } catch { /* sharing table may not exist yet */ }

  // Subject external links table (Jira, Notion, Roadmap)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subject_external_links (
        id SERIAL PRIMARY KEY,
        subject_id UUID NOT NULL REFERENCES suivitess_subjects(id) ON DELETE CASCADE,
        service VARCHAR(20) NOT NULL,
        external_id VARCHAR(200) NOT NULL,
        external_url TEXT NOT NULL,
        external_title TEXT,
        external_status TEXT,
        metadata JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(subject_id, service, external_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sel_subject ON subject_external_links(subject_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sel_service ON subject_external_links(service, external_id)');
  } catch (err) {
    console.warn('[SuiVitess] subject_external_links migration failed:', (err as Error).message);
  }

  // Subject cross-document links — see migration 27. Auto-applied
  // here so the boot path doesn't depend on the SQL init folder
  // running (it doesn't on existing DBs).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suivitess_subject_cross_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        origin_subject_id UUID NOT NULL REFERENCES suivitess_subjects(id) ON DELETE CASCADE,
        target_section_id UUID NOT NULL REFERENCES suivitess_sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(origin_subject_id, target_section_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_subj_links_origin ON suivitess_subject_cross_links(origin_subject_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_subj_links_target ON suivitess_subject_cross_links(target_section_id)');
  } catch (err) {
    console.warn('[SuiVitess] subject cross-links migration failed:', (err as Error).message);
  }

  // Auto-import feature : per-document config + accumulated inbox
  // proposals waiting for human validation. See migration
  // 30_suivitess_auto_import_schema.sql for the contract.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suivitess_auto_import_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        enabled_sources TEXT[] NOT NULL DEFAULT '{}',
        last_run_at TIMESTAMPTZ,
        last_error TEXT,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, document_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_autoimport_config_enabled ON suivitess_auto_import_config(enabled, last_run_at) WHERE enabled = TRUE');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suivitess_inbox_proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_title TEXT,
        source_date TIMESTAMPTZ,
        proposals JSONB NOT NULL,
        ai_log_id INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'rejected')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_user_status ON suivitess_inbox_proposals(user_id, status, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_document ON suivitess_inbox_proposals(document_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_source ON suivitess_inbox_proposals(source_kind, source_id)');
    // Per-user settings : master kill-switch + which providers the
    // hourly cron is allowed to pull from. The set of TARGET docs
    // is decided per-doc via `suivitess_auto_import_config.enabled`
    // — the AI then routes each subject AMONG those opted-in docs.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suivitess_user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        auto_import_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE suivitess_user_settings ADD COLUMN IF NOT EXISTS auto_import_sources TEXT[] NOT NULL DEFAULT '{}'");
    await pool.query('ALTER TABLE suivitess_user_settings ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE suivitess_user_settings ADD COLUMN IF NOT EXISTS last_error TEXT');
    await pool.query('ALTER TABLE suivitess_user_settings ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER NOT NULL DEFAULT 0');
  } catch (err) {
    console.warn('[SuiVitess] auto-import migration failed:', (err as Error).message);
  }

  // Live subject marks during a recording. Each row = one click on
  // a subject button (or the "stop marking" button → subject_id =
  // null). The pipeline T1 transcript fetches them at import time
  // and converts to relative offsets vs. the call's recorded_at,
  // injecting them as ground-truth into the extraction prompt.
  // See migration 29_suivitess_subject_marks_schema.sql.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suivitess_subject_marks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
        subject_id UUID REFERENCES suivitess_subjects(id) ON DELETE SET NULL,
        clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_marks_user_doc ON suivitess_subject_marks(user_id, document_id, clicked_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_suivitess_marks_clicked_at ON suivitess_subject_marks(clicked_at DESC)');
  } catch (err) {
    console.warn('[SuiVitess] subject marks migration failed:', (err as Error).message);
  }

  console.log('[SuiVitess] Module initialized');
}

// ==================== SUBJECT EXTERNAL LINKS ====================

export interface ExternalLink {
  id: number;
  subjectId: string;
  service: 'jira' | 'notion' | 'roadmap';
  externalId: string;
  externalUrl: string;
  externalTitle: string | null;
  externalStatus: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function formatLink(row: Record<string, unknown>): ExternalLink {
  return {
    id: row.id as number,
    subjectId: row.subject_id as string,
    service: row.service as 'jira' | 'notion' | 'roadmap',
    externalId: row.external_id as string,
    externalUrl: row.external_url as string,
    externalTitle: row.external_title as string | null,
    externalStatus: row.external_status as string | null,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function getSubjectLinks(subjectId: string): Promise<ExternalLink[]> {
  const { rows } = await pool.query(
    'SELECT * FROM subject_external_links WHERE subject_id = $1 ORDER BY created_at DESC',
    [subjectId]
  );
  return rows.map(formatLink);
}

export async function createSubjectLink(
  subjectId: string,
  service: 'jira' | 'notion' | 'roadmap',
  externalId: string,
  externalUrl: string,
  externalTitle: string | null,
  externalStatus: string | null,
  metadata: Record<string, unknown> | null,
  createdBy: number,
): Promise<ExternalLink> {
  const { rows } = await pool.query(
    `INSERT INTO subject_external_links
     (subject_id, service, external_id, external_url, external_title, external_status, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (subject_id, service, external_id) DO UPDATE SET
       external_url = EXCLUDED.external_url,
       external_title = EXCLUDED.external_title,
       external_status = EXCLUDED.external_status,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [subjectId, service, externalId, externalUrl, externalTitle, externalStatus, metadata ? JSON.stringify(metadata) : null, createdBy]
  );
  return formatLink(rows[0]);
}

export async function deleteSubjectLink(linkId: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM subject_external_links WHERE id = $1', [linkId]);
  return (rowCount ?? 0) > 0;
}

export async function getSubjectsLinkedToTask(
  service: 'jira' | 'notion' | 'roadmap',
  externalId: string,
): Promise<Array<{ subjectId: string; subjectTitle: string; documentId: string; documentTitle: string; sectionName: string }>> {
  const { rows } = await pool.query(
    `SELECT s.id AS subject_id, s.title AS subject_title,
            d.id AS document_id, d.title AS document_title,
            sec.name AS section_name
     FROM subject_external_links sel
     JOIN suivitess_subjects s ON s.id = sel.subject_id
     JOIN suivitess_sections sec ON sec.id = s.section_id
     JOIN suivitess_documents d ON d.id = sec.document_id
     WHERE sel.service = $1 AND sel.external_id = $2
     ORDER BY d.title, sec.position, s.position`,
    [service, externalId]
  );
  return rows.map((r: Record<string, unknown>) => ({
    subjectId: r.subject_id as string,
    subjectTitle: r.subject_title as string,
    documentId: r.document_id as string,
    documentTitle: r.document_title as string,
    sectionName: r.section_name as string,
  }));
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
    // Native subjects (whose canonical home is this section).
    const nativeRes = await pool.query(
      'SELECT * FROM suivitess_subjects WHERE section_id = $1 ORDER BY position',
      [section.id]
    );
    const nativeSubjects: Subject[] = nativeRes.rows.map((r: Subject) => ({ ...r, linkedFromSectionId: null }));

    // Subjects pulled in by a cross-link. We surface the canonical
    // subject row but tag it with the origin section + document so
    // the UI can render the "🔗 lié depuis X" badge. Best-effort —
    // if the link table doesn't exist (legacy DB), we just return
    // the native subjects.
    let linkedSubjects: Subject[] = [];
    try {
      const linkedRes = await pool.query(`
        SELECT
          sub.*,
          link.id           AS link_id,
          link.position     AS link_position,
          origin_sec.id     AS origin_section_id,
          origin_sec.name   AS origin_section_name,
          origin_doc.id     AS origin_document_id,
          origin_doc.title  AS origin_document_title
        FROM suivitess_subject_cross_links link
        JOIN suivitess_subjects   sub        ON sub.id = link.origin_subject_id
        JOIN suivitess_sections   origin_sec ON origin_sec.id = sub.section_id
        JOIN suivitess_documents  origin_doc ON origin_doc.id = origin_sec.document_id
        WHERE link.target_section_id = $1
        ORDER BY link.position, link.created_at
      `, [section.id]);
      linkedSubjects = linkedRes.rows.map((r: Subject & {
        link_id: string;
        link_position: number;
        origin_section_id: string;
        origin_section_name: string;
        origin_document_id: string;
        origin_document_title: string;
      }) => ({
        ...r,
        // Keep the canonical id so PATCH /subjects/:id edits the
        // single source of truth. The render-time `position` is the
        // link's position (so the user can reorder linked + native
        // freely inside the target section).
        position: r.link_position ?? r.position,
        linkId: r.link_id,
        linkedFromSectionId: r.origin_section_id,
        linkedFromSectionName: r.origin_section_name,
        linkedFromDocumentId: r.origin_document_id,
        linkedFromDocumentTitle: r.origin_document_title,
      }));
    } catch (err) {
      console.warn('[SuiVitess] linked subjects fetch failed:', (err as Error).message);
    }

    // Merge by position. Native subjects' position lives on
    // `suivitess_subjects.position`, linked ones on
    // `suivitess_subject_cross_links.position`. Sort the union so the
    // user sees one continuous ordered list.
    const merged = [...nativeSubjects, ...linkedSubjects].sort((a, b) => a.position - b.position);

    sections.push({
      ...section,
      subjects: merged,
    });
  }

  return {
    id: doc.id,
    title: doc.title,
    sections,
    updated_at: doc.updated_at,
  };
}

export async function createSnapshotForDocument(documentId: string, type: string = 'manual'): Promise<void> {
  const doc = await getDocumentWithSections(documentId);
  if (!doc) return;

  await pool.query(
    'INSERT INTO suivitess_snapshots (document_id, snapshot_data, type) VALUES ($1, $2, $3)',
    [documentId, JSON.stringify(doc), type]
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
    const result = await pool.query('SELECT id, title, description, created_at, updated_at FROM suivitess_documents ORDER BY updated_at DESC NULLS LAST, title');
    return result.rows;
  }
  const result = await pool.query(
    `SELECT d.id, d.title, d.description, d.created_at, d.updated_at FROM suivitess_documents d
     LEFT JOIN resource_sharing rs ON rs.resource_type = 'suivitess' AND rs.resource_id = d.id
     LEFT JOIN resource_shares rsh ON rsh.resource_type = 'suivitess' AND rsh.resource_id = d.id AND rsh.shared_with_user_id = $1
     WHERE rs.id IS NULL OR rs.owner_id = $1 OR rs.visibility = 'public' OR rsh.id IS NOT NULL
     ORDER BY d.updated_at DESC NULLS LAST, d.title`,
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

export async function setSubjectNoActionNeeded(subjectId: string, value: boolean) {
  const result = await pool.query(
    `UPDATE suivitess_subjects SET no_action_needed = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [subjectId, value]
  );
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

// ==================== SUBJECT CROSS-LINKS ====================

export interface SubjectCrossLink {
  id: string;
  originSubjectId: string;
  targetSectionId: string;
  position: number;
  createdAt: string;
}

/** Create a cross-doc link : surface `subjectId` inside another
 *  section. Idempotent — a second call with the same pair returns
 *  the existing link row instead of duplicating. Returns null if the
 *  target section is the canonical home of the subject (linking a
 *  subject to its own section makes no sense — the UI prevents it
 *  too). */
export async function createSubjectCrossLink(
  originSubjectId: string,
  targetSectionId: string,
): Promise<SubjectCrossLink | null> {
  // Reject self-link : the canonical section already shows the subject.
  const subj = await pool.query('SELECT section_id FROM suivitess_subjects WHERE id = $1', [originSubjectId]);
  if (subj.rows.length === 0) throw new Error('Subject introuvable');
  if (subj.rows[0].section_id === targetSectionId) return null;

  // Position : append at the end of the target section's existing
  // links, so newly-linked subjects sit at the bottom of their slot.
  const tail = await pool.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
     FROM suivitess_subject_cross_links
     WHERE target_section_id = $1`,
    [targetSectionId],
  );
  const nextPos: number = tail.rows[0]?.next_pos ?? 0;

  const result = await pool.query(
    `INSERT INTO suivitess_subject_cross_links (origin_subject_id, target_section_id, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (origin_subject_id, target_section_id) DO UPDATE SET position = suivitess_subject_cross_links.position
     RETURNING id, origin_subject_id, target_section_id, position, created_at`,
    [originSubjectId, targetSectionId, nextPos],
  );
  const r = result.rows[0];
  return {
    id: r.id,
    originSubjectId: r.origin_subject_id,
    targetSectionId: r.target_section_id,
    position: r.position,
    createdAt: r.created_at,
  };
}

export async function deleteSubjectCrossLink(linkId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM suivitess_subject_cross_links WHERE id = $1',
    [linkId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** List every section/document where `subjectId` is currently
 *  surfaced as a link, plus its canonical home. Used by the
 *  "Ce sujet est lié à N suivis" inspector on the subject card. */
export async function listSubjectCrossLinks(subjectId: string): Promise<Array<{
  linkId: string | null;
  sectionId: string;
  sectionName: string;
  documentId: string;
  documentTitle: string;
  isCanonical: boolean;
}>> {
  const result = await pool.query(`
    -- Canonical home (no link row).
    SELECT
      NULL::uuid              AS link_id,
      sec.id                  AS section_id,
      sec.name                AS section_name,
      doc.id                  AS document_id,
      doc.title               AS document_title,
      true                    AS is_canonical
    FROM suivitess_subjects sub
    JOIN suivitess_sections   sec ON sec.id = sub.section_id
    JOIN suivitess_documents  doc ON doc.id = sec.document_id
    WHERE sub.id = $1

    UNION ALL

    -- Cross-link occurrences.
    SELECT
      link.id                 AS link_id,
      sec.id                  AS section_id,
      sec.name                AS section_name,
      doc.id                  AS document_id,
      doc.title               AS document_title,
      false                   AS is_canonical
    FROM suivitess_subject_cross_links link
    JOIN suivitess_sections   sec ON sec.id = link.target_section_id
    JOIN suivitess_documents  doc ON doc.id = sec.document_id
    WHERE link.origin_subject_id = $1
    ORDER BY is_canonical DESC, document_title
  `, [subjectId]);
  return result.rows.map(r => ({
    linkId: r.link_id,
    sectionId: r.section_id,
    sectionName: r.section_name,
    documentId: r.document_id,
    documentTitle: r.document_title,
    isCanonical: r.is_canonical,
  }));
}

// ==================== SUBJECT MARKS (live recording) ====================
//
// Each row = one click on a subject's "🎙️ on en parle" button (or
// the "stop marking" button → subject_id = null) during a meeting.
// Surfaced at transcript import time as ground-truth for T1. Strictly
// ADDITIVE : the import works exactly as before when no marks exist
// (and most users will never use them).

export interface SubjectMark {
  id: string;
  userId: number;
  documentId: string;
  /** null = the user explicitly stopped marking ("hors-sujet"). The
   *  pipeline interprets a null mark as the END of the previous
   *  subject's window. */
  subjectId: string | null;
  clickedAt: string;        // ISO 8601 UTC
  /** Denormalized for the UI banner / verification modal — saves a
   *  JOIN on the hot path. */
  subjectTitle: string | null;
}

function mapMarkRow(row: any): SubjectMark {
  return {
    id: row.id,
    userId: row.user_id,
    documentId: row.document_id,
    subjectId: row.subject_id ?? null,
    clickedAt: row.clicked_at instanceof Date
      ? row.clicked_at.toISOString()
      : String(row.clicked_at),
    subjectTitle: row.subject_title ?? null,
  };
}

/** Insert a fresh mark. clicked_at is stamped server-side via DEFAULT
 *  NOW() — we never trust the client's clock. */
export async function insertSubjectMark(
  userId: number,
  documentId: string,
  subjectId: string | null,
): Promise<SubjectMark> {
  const result = await pool.query(
    `WITH ins AS (
       INSERT INTO suivitess_subject_marks (user_id, document_id, subject_id)
       VALUES ($1, $2, $3)
       RETURNING *
     )
     SELECT ins.*, s.title AS subject_title
       FROM ins
       LEFT JOIN suivitess_subjects s ON s.id = ins.subject_id`,
    [userId, documentId, subjectId],
  );
  return mapMarkRow(result.rows[0]);
}

/** Most recent mark for (user, document) — used by the frontend
 *  banner to show what's currently being marked. Returns null when
 *  the user has never clicked, or when the latest click was a
 *  "stop marking" (subject_id null). */
export async function getActiveSubjectMark(
  userId: number,
  documentId: string,
): Promise<SubjectMark | null> {
  const result = await pool.query(
    `SELECT m.*, s.title AS subject_title
       FROM suivitess_subject_marks m
       LEFT JOIN suivitess_subjects s ON s.id = m.subject_id
      WHERE m.user_id = $1 AND m.document_id = $2
      ORDER BY m.clicked_at DESC
      LIMIT 1`,
    [userId, documentId],
  );
  return result.rows[0] ? mapMarkRow(result.rows[0]) : null;
}

/** All marks within an inclusive time window. Used by the T1
 *  pipeline to fetch the marks that fall inside a Fathom call's
 *  recorded_at + duration. Filters strictly by document so marks
 *  on a sibling suivitess never bleed in. */
export async function getSubjectMarksInWindow(
  userId: number,
  documentId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<SubjectMark[]> {
  const result = await pool.query(
    `SELECT m.*, s.title AS subject_title
       FROM suivitess_subject_marks m
       LEFT JOIN suivitess_subjects s ON s.id = m.subject_id
      WHERE m.user_id = $1
        AND m.document_id = $2
        AND m.clicked_at >= $3
        AND m.clicked_at <= $4
      ORDER BY m.clicked_at ASC`,
    [userId, documentId, windowStart.toISOString(), windowEnd.toISOString()],
  );
  return result.rows.map(mapMarkRow);
}

/** Delete a single mark — exposed so the user can undo a
 *  misclicked button without committing a new "stop marking"
 *  entry. Owner check happens via the user_id filter. */
export async function deleteSubjectMark(
  markId: string,
  userId: number,
): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM suivitess_subject_marks WHERE id = $1 AND user_id = $2',
    [markId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
