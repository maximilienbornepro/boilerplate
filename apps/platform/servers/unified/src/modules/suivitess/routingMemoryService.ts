// ═══════════════════════════════════════════════════════════════════════
// SuiviTess routing memory — per-user RAG of past (subject → review/section)
// decisions, used to make the place-in-reviews skill increasingly accurate
// over time via few-shot in-context learning.
//
// Write-path : called from POST /transcription/apply-routing after the user
// confirms the import. For each applied subject, we embed the subject title
// + raw quotes, and persist the final routing alongside.
//
// Read-path : called from tier2PlaceReviews before invoking the skill. For
// each extracted subject of the current batch, we retrieve the top-K most
// similar past decisions via pgvector cosine distance, and inject them as
// examples in the prompt.
//
// Both paths are non-blocking : if the embedding provider is unreachable,
// we log a warning and continue. The pipeline degrades to its legacy
// behavior with no silent data loss.
// ═══════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { config } from '../../config/env.js';

let pool: pg.Pool | null = null;
let pgvectorReady = false;
let embeddingDim = 0;

export async function initRoutingMemory(): Promise<void> {
  pool = new pg.Pool({ connectionString: config.appDatabaseUrl });

  // Pull the embedding dimension lazily from the RAG service so we match
  // whatever provider is configured (OpenAI 1536 / Scaleway 3584 / etc).
  try {
    const { getEmbeddingDimension } = await import('../rag/services/embeddingService.js');
    embeddingDim = getEmbeddingDimension();
  } catch {
    embeddingDim = 1536; // safe fallback
  }

  // Add the embedding column dynamically — same pattern as rag/dbService.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(
      `ALTER TABLE suivitess_routing_memory
         ADD COLUMN IF NOT EXISTS embedding halfvec(${embeddingDim})`,
    );
    // If an old column exists with a different dim, drop and recreate.
    const { rows } = await pool.query<{ atttypmod: number }>(
      `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'suivitess_routing_memory'::regclass
         AND attname = 'embedding'`,
    );
    const currentDim = rows[0]?.atttypmod ?? -1;
    // halfvec's atttypmod encodes the dimension at +4 offset.
    const storedDim = currentDim > 0 ? currentDim - 4 : -1;
    if (storedDim > 0 && storedDim !== embeddingDim) {
      // eslint-disable-next-line no-console
      console.warn(`[routingMemory] embedding dimension changed ${storedDim} → ${embeddingDim}, recreating column`);
      await pool.query('ALTER TABLE suivitess_routing_memory DROP COLUMN embedding');
      await pool.query(
        `ALTER TABLE suivitess_routing_memory ADD COLUMN embedding halfvec(${embeddingDim})`,
      );
    }
    // IVFFlat index on halfvec for fast cosine ANN.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_routing_memory_embedding
      ON suivitess_routing_memory
      USING ivfflat (embedding halfvec_cosine_ops)
      WITH (lists = 100)
    `).catch(() => { /* index may fail on empty tables, recreated later */ });
    pgvectorReady = true;
    // eslint-disable-next-line no-console
    console.log(`[routingMemory] ready (dim=${embeddingDim})`);
  } catch (err) {
    pgvectorReady = false;
    // eslint-disable-next-line no-console
    console.warn('[routingMemory] pgvector unavailable, RAG-learning disabled:', err);
  }
}

export interface RoutingMemoryRow {
  id: string;
  subjectTitle: string;
  subjectSituationExcerpt: string | null;
  rawQuotesJoined: string | null;
  entities: string[];
  participants: string[];
  targetDocumentId: string;
  targetDocumentTitle: string;
  targetSectionId: string | null;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  createdAt: string;
  /** Cosine similarity [-1, 1] to the query embedding. Only set by retrieveSimilar. */
  similarity?: number;
}

/** Build the text used for embedding. Kept compact so retrieval latency
 *  stays low and the embedding provider doesn't choke on multi-MB inputs. */
function embedText(params: {
  subjectTitle: string;
  rawQuotes?: string[];
  entities?: string[];
}): string {
  const parts = [params.subjectTitle];
  if (params.entities && params.entities.length > 0) {
    parts.push(`Entités : ${params.entities.slice(0, 10).join(', ')}`);
  }
  if (params.rawQuotes && params.rawQuotes.length > 0) {
    parts.push(params.rawQuotes.slice(0, 5).join(' · '));
  }
  return parts.join('\n').slice(0, 3000);
}

/** Persist a validated routing decision. Never throws — logs and returns
 *  null if the embedding step fails or the DB is down. */
export async function storeDecision(params: {
  userId: number;
  subjectTitle: string;
  subjectSituationExcerpt: string | null;
  rawQuotes: string[];
  entities: string[];
  participants: string[];
  targetDocumentId: string;
  targetDocumentTitle: string;
  targetSectionId: string | null;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  aiProposedDocumentId?: string | null;
  aiProposedDocumentTitle?: string | null;
}): Promise<string | null> {
  if (!pool) return null;
  if (!pgvectorReady) return null;

  try {
    const { generateEmbedding } = await import('../rag/services/embeddingService.js');
    const rawQuotesJoined = params.rawQuotes.join('\n');
    const text = embedText({
      subjectTitle: params.subjectTitle,
      rawQuotes: params.rawQuotes,
      entities: params.entities,
    });
    const embedding = await generateEmbedding(text);
    const userOverrodeAi = !!params.aiProposedDocumentId
      && params.aiProposedDocumentId !== params.targetDocumentId;

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO suivitess_routing_memory (
         user_id, subject_title, subject_situation_excerpt, raw_quotes_joined,
         entities, participants,
         target_document_id, target_document_title,
         target_section_id, target_section_name, target_subject_action,
         ai_proposed_document_id, ai_proposed_document_title, user_overrode_ai,
         embedding
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        params.userId,
        params.subjectTitle,
        params.subjectSituationExcerpt,
        rawQuotesJoined,
        params.entities,
        params.participants,
        params.targetDocumentId,
        params.targetDocumentTitle,
        params.targetSectionId,
        params.targetSectionName,
        params.targetSubjectAction,
        params.aiProposedDocumentId ?? null,
        params.aiProposedDocumentTitle ?? null,
        userOverrodeAi,
        toPgVectorLiteral(embedding),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[routingMemory] storeDecision failed:', err);
    return null;
  }
}

/** Retrieve the top-K past decisions semantically similar to the given
 *  subject. Returns [] if pgvector is down or the user has no memory yet.
 *  Never throws. */
export async function retrieveSimilar(params: {
  userId: number;
  subjectTitle: string;
  rawQuotes: string[];
  entities: string[];
  k?: number;
}): Promise<RoutingMemoryRow[]> {
  if (!pool || !pgvectorReady) return [];
  const k = params.k ?? 5;

  try {
    const { generateEmbedding } = await import('../rag/services/embeddingService.js');
    const text = embedText({
      subjectTitle: params.subjectTitle,
      rawQuotes: params.rawQuotes,
      entities: params.entities,
    });
    const queryEmbedding = await generateEmbedding(text);

    // Cosine distance (operator `<=>`) : 0 = identical, 1 = orthogonal, 2 = opposite.
    // We convert to similarity = 1 - distance in the SELECT.
    const { rows } = await pool.query<{
      id: string; subject_title: string; subject_situation_excerpt: string | null;
      raw_quotes_joined: string | null; entities: string[]; participants: string[];
      target_document_id: string; target_document_title: string;
      target_section_id: string | null; target_section_name: string;
      target_subject_action: 'new-subject' | 'update-existing-subject';
      created_at: Date; distance: number;
    }>(
      `SELECT id, subject_title, subject_situation_excerpt, raw_quotes_joined,
              entities, participants,
              target_document_id, target_document_title,
              target_section_id, target_section_name, target_subject_action,
              created_at,
              (embedding <=> $2::halfvec) AS distance
       FROM suivitess_routing_memory
       WHERE user_id = $1
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::halfvec
       LIMIT $3`,
      [params.userId, toPgVectorLiteral(queryEmbedding), k],
    );

    return rows.map(r => ({
      id: r.id,
      subjectTitle: r.subject_title,
      subjectSituationExcerpt: r.subject_situation_excerpt,
      rawQuotesJoined: r.raw_quotes_joined,
      entities: r.entities ?? [],
      participants: r.participants ?? [],
      targetDocumentId: r.target_document_id,
      targetDocumentTitle: r.target_document_title,
      targetSectionId: r.target_section_id,
      targetSectionName: r.target_section_name,
      targetSubjectAction: r.target_subject_action,
      createdAt: r.created_at.toISOString(),
      similarity: 1 - Number(r.distance),
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[routingMemory] retrieveSimilar failed:', err);
    return [];
  }
}

/** Format a human-readable examples block for injection into the T2 prompt.
 *  Deduplicates identical (doc, section) tuples and caps at 8 lines so the
 *  prompt stays bounded. */
export function formatExamplesBlock(rows: RoutingMemoryRow[]): string {
  if (rows.length === 0) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of rows) {
    if (r.similarity != null && r.similarity < 0.3) continue; // too far away
    const key = `${r.targetDocumentTitle}::${r.targetSectionName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sim = r.similarity != null ? ` (sim=${r.similarity.toFixed(2)})` : '';
    const actionLabel = r.targetSubjectAction === 'update-existing-subject'
      ? ' [mis à jour]' : '';
    lines.push(`- « ${r.subjectTitle} »${sim}\n  → Review "${r.targetDocumentTitle}" / section "${r.targetSectionName}"${actionLabel}`);
    if (lines.length >= 8) break;
  }
  return lines.join('\n');
}

/** Lists recent memory entries for the admin UI. No embedding column
 *  returned — just the inspectable metadata. */
export async function listRecentMemory(userId: number, limit = 50): Promise<RoutingMemoryRow[]> {
  if (!pool) return [];
  const { rows } = await pool.query<{
    id: string; subject_title: string; subject_situation_excerpt: string | null;
    raw_quotes_joined: string | null; entities: string[]; participants: string[];
    target_document_id: string; target_document_title: string;
    target_section_id: string | null; target_section_name: string;
    target_subject_action: 'new-subject' | 'update-existing-subject';
    created_at: Date;
  }>(
    `SELECT id, subject_title, subject_situation_excerpt, raw_quotes_joined,
            entities, participants,
            target_document_id, target_document_title,
            target_section_id, target_section_name, target_subject_action,
            created_at
     FROM suivitess_routing_memory
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(r => ({
    id: r.id,
    subjectTitle: r.subject_title,
    subjectSituationExcerpt: r.subject_situation_excerpt,
    rawQuotesJoined: r.raw_quotes_joined,
    entities: r.entities ?? [],
    participants: r.participants ?? [],
    targetDocumentId: r.target_document_id,
    targetDocumentTitle: r.target_document_title,
    targetSectionId: r.target_section_id,
    targetSectionName: r.target_section_name,
    targetSubjectAction: r.target_subject_action,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Delete a specific memory entry — used by the admin UI when the user
 *  spots a bad entry that's influencing future imports incorrectly. */
export async function deleteMemory(userId: number, id: string): Promise<boolean> {
  if (!pool) return false;
  const { rowCount } = await pool.query(
    'DELETE FROM suivitess_routing_memory WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

// ── pgvector literal helper ─────────────────────────────────────────
// pg sends array as $1::halfvec but we need bracket syntax "[0.1,0.2,...]"
function toPgVectorLiteral(vec: number[]): string {
  return '[' + vec.join(',') + ']';
}
