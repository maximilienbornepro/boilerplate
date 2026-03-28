import pg from 'pg';

let pool: pg.Pool;
let pgvectorAvailable = false;

export function initDbService(sharedPool: pg.Pool) {
  pool = sharedPool;
}

export function isPgvectorAvailable(): boolean {
  return pgvectorAvailable;
}

/**
 * Initializes pgvector extension and embedding column.
 * If pgvector is not installed, the module runs in degraded mode (no semantic search).
 */
export async function initPgvector(dimension = 1536): Promise<boolean> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Check current embedding dimension
    const dimResult = await pool.query(`
      SELECT atttypmod FROM pg_attribute
      JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
      WHERE pg_class.relname = 'rag_chunks' AND pg_attribute.attname = 'embedding'
    `);

    if (dimResult.rows.length === 0) {
      // Add embedding column
      await pool.query(`ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS embedding halfvec(${dimension})`);
      // Use HNSW index — no dimension limit (IVFFlat is capped at 2000 dims)
      await pool.query(
        `CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)`
      );
      console.log(`[RAG] pgvector enabled, dimension=${dimension}, index=hnsw`);
    } else {
      const currentDim = dimResult.rows[0].atttypmod - 4;
      if (currentDim !== dimension) {
        // Provider changed — drop and recreate embedding column
        console.log(`[RAG] Embedding dimension changed (${currentDim} → ${dimension}), recreating column`);
        await pool.query('DROP INDEX IF EXISTS rag_chunks_embedding_idx');
        await pool.query('ALTER TABLE rag_chunks DROP COLUMN IF EXISTS embedding');
        await pool.query(`ALTER TABLE rag_chunks ADD COLUMN embedding halfvec(${dimension})`);
        await pool.query(
          `CREATE INDEX rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)`
        );
        console.log('[RAG] Re-indexing needed after dimension change');
      }
    }

    pgvectorAvailable = true;
    return true;
  } catch (err) {
    console.warn('[RAG] pgvector not available — semantic search disabled:', (err as Error).message);
    pgvectorAvailable = false;
    return false;
  }
}

// ============ Types ============

export interface ConversationRow {
  id: number;
  userId: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[] | null;
  createdAt: string;
}

export interface Source {
  sourceId?: string;
  title: string;
  url?: string;
  spaceKey?: string;
  heading?: string;
  sourceType: string;
}

export interface ChunkRow {
  id: number;
  sourceId: string | null;
  documentId: number | null;
  sourceType: string;
  heading: string | null;
  content: string;
  tokenCount: number | null;
}

export interface RagBotRow {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  userId: number;
  createdAt: string;
  documentCount: number;
  chunkCount: number;
}

// ============ RAG Bots ============

export async function getRagBots(userId: number): Promise<RagBotRow[]> {
  const result = await pool.query(
    `SELECT b.id, b.uuid, b.name, b.description, b.user_id, b.created_at,
            COUNT(DISTINCT d.id) AS document_count,
            COUNT(c.id) AS chunk_count
     FROM rag_bots b
     LEFT JOIN rag_documents d ON d.rag_id = b.id
     LEFT JOIN rag_chunks c ON c.rag_id = b.id
     WHERE b.user_id = $1
     GROUP BY b.id
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    uuid: r.uuid,
    name: r.name,
    description: r.description,
    userId: r.user_id,
    createdAt: r.created_at,
    documentCount: parseInt(r.document_count, 10),
    chunkCount: parseInt(r.chunk_count, 10),
  }));
}

export async function getRagBot(id: number, userId: number): Promise<RagBotRow | null> {
  const result = await pool.query(
    `SELECT b.id, b.uuid, b.name, b.description, b.user_id, b.created_at,
            COUNT(DISTINCT d.id) AS document_count,
            COUNT(c.id) AS chunk_count
     FROM rag_bots b
     LEFT JOIN rag_documents d ON d.rag_id = b.id
     LEFT JOIN rag_chunks c ON c.rag_id = b.id
     WHERE b.id = $1 AND b.user_id = $2
     GROUP BY b.id`,
    [id, userId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id, uuid: r.uuid, name: r.name, description: r.description,
    userId: r.user_id, createdAt: r.created_at,
    documentCount: parseInt(r.document_count, 10),
    chunkCount: parseInt(r.chunk_count, 10),
  };
}

export async function getRagBotByUuid(uuid: string): Promise<RagBotRow | null> {
  const result = await pool.query(
    `SELECT b.id, b.uuid, b.name, b.description, b.user_id, b.created_at,
            COUNT(DISTINCT d.id) AS document_count,
            COUNT(c.id) AS chunk_count
     FROM rag_bots b
     LEFT JOIN rag_documents d ON d.rag_id = b.id
     LEFT JOIN rag_chunks c ON c.rag_id = b.id
     WHERE b.uuid = $1
     GROUP BY b.id`,
    [uuid]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id, uuid: r.uuid, name: r.name, description: r.description,
    userId: r.user_id, createdAt: r.created_at,
    documentCount: parseInt(r.document_count, 10),
    chunkCount: parseInt(r.chunk_count, 10),
  };
}

export async function createRagBot(userId: number, name: string, description?: string): Promise<RagBotRow> {
  const result = await pool.query(
    `INSERT INTO rag_bots (user_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING id, uuid, name, description, user_id, created_at`,
    [userId, name, description ?? null]
  );
  const r = result.rows[0];
  return {
    id: r.id, uuid: r.uuid, name: r.name, description: r.description,
    userId: r.user_id, createdAt: r.created_at,
    documentCount: 0, chunkCount: 0,
  };
}

export async function updateRagBot(id: number, userId: number, data: { name?: string; description?: string }): Promise<RagBotRow | null> {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  let i = 1;
  if (data.name !== undefined) { sets.push(`name = $${i++}`); params.push(data.name); }
  if (data.description !== undefined) { sets.push(`description = $${i++}`); params.push(data.description); }
  if (sets.length === 0) return getRagBot(id, userId);
  params.push(id, userId);
  const result = await pool.query(
    `UPDATE rag_bots SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i}
     RETURNING id, uuid, name, description, user_id, created_at`,
    params
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id, uuid: r.uuid, name: r.name, description: r.description,
    userId: r.user_id, createdAt: r.created_at,
    documentCount: 0, chunkCount: 0,
  };
}

export async function deleteRagBot(id: number, userId: number): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM rag_bots WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.rowCount! > 0;
}

// ============ Conversations ============

export async function getConversations(userId: number): Promise<ConversationRow[]> {
  const result = await pool.query(
    `SELECT id, user_id, title, created_at, updated_at
     FROM rag_conversations WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map((r) => ({
    id: r.id, userId: r.user_id, title: r.title,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function createConversation(userId: number, title: string | null): Promise<ConversationRow> {
  const result = await pool.query(
    `INSERT INTO rag_conversations (user_id, title) VALUES ($1, $2)
     RETURNING id, user_id, title, created_at, updated_at`,
    [userId, title]
  );
  const r = result.rows[0];
  return { id: r.id, userId: r.user_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function deleteConversation(id: number, userId: number): Promise<void> {
  await pool.query('DELETE FROM rag_conversations WHERE id = $1 AND user_id = $2', [id, userId]);
}

export async function touchConversation(id: number): Promise<void> {
  await pool.query('UPDATE rag_conversations SET updated_at = NOW() WHERE id = $1', [id]);
}

// ============ Messages ============

export async function getMessages(conversationId: number): Promise<MessageRow[]> {
  const result = await pool.query(
    `SELECT id, conversation_id, role, content, sources, created_at
     FROM rag_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId]
  );
  return result.rows.map((r) => ({
    id: r.id, conversationId: r.conversation_id, role: r.role,
    content: r.content, sources: r.sources, createdAt: r.created_at,
  }));
}

export async function saveMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  sources?: Source[]
): Promise<MessageRow> {
  const result = await pool.query(
    `INSERT INTO rag_messages (conversation_id, role, content, sources)
     VALUES ($1, $2, $3, $4)
     RETURNING id, conversation_id, role, content, sources, created_at`,
    [conversationId, role, content, sources ? JSON.stringify(sources) : null]
  );
  const r = result.rows[0];
  return {
    id: r.id, conversationId: r.conversation_id, role: r.role,
    content: r.content, sources: r.sources, createdAt: r.created_at,
  };
}

// ============ Chunks (vector search) ============

export async function searchSimilarChunks(embedding: number[], limit = 10, ragId?: number): Promise<ChunkRow[]> {
  if (!pgvectorAvailable) return [];
  const embeddingStr = `[${embedding.join(',')}]`;
  const whereClause = ragId != null ? 'WHERE rag_id = $3' : '';
  const params: (string | number)[] = ragId != null
    ? [embeddingStr, limit, ragId]
    : [embeddingStr, limit];
  const result = await pool.query(
    `SELECT id, source_id, document_id, source_type, heading, content, token_count
     FROM rag_chunks
     ${whereClause}
     ORDER BY embedding <=> $1::halfvec
     LIMIT $2`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id, sourceId: r.source_id, documentId: r.document_id,
    sourceType: r.source_type, heading: r.heading, content: r.content, tokenCount: r.token_count,
  }));
}

/** Keyword fallback — used when pgvector is unavailable or embeddings fail. */
export async function keywordSearchChunks(query: string, limit = 10, ragId?: number): Promise<ChunkRow[]> {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 2);
  const ragFilter = ragId != null ? ' AND rag_id = $1' : '';
  const paramOffset = ragId != null ? 2 : 1;

  if (words.length === 0) {
    const params: (string | number)[] = ragId != null ? [ragId, limit] : [limit];
    const result = await pool.query(
      `SELECT id, source_id, document_id, source_type, heading, content, token_count
       FROM rag_chunks WHERE TRUE${ragFilter} ORDER BY id DESC LIMIT $${paramOffset}`,
      params
    );
    return result.rows.map((r) => ({
      id: r.id, sourceId: r.source_id, documentId: r.document_id,
      sourceType: r.source_type, heading: r.heading, content: r.content, tokenCount: r.token_count,
    }));
  }

  const conditions = words.map((_, i) => `(content ILIKE $${i + paramOffset + 1} OR heading ILIKE $${i + paramOffset + 1})`);
  const limitParam = `$${paramOffset}`;
  const params: (string | number)[] = ragId != null
    ? [ragId, limit, ...words.map((w) => `%${w}%`)]
    : [limit, ...words.map((w) => `%${w}%`)];

  const result = await pool.query(
    `SELECT id, source_id, document_id, source_type, heading, content, token_count
     FROM rag_chunks WHERE TRUE${ragFilter} AND (${conditions.join(' OR ')})
     LIMIT ${limitParam}`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id, sourceId: r.source_id, documentId: r.document_id,
    sourceType: r.source_type, heading: r.heading, content: r.content, tokenCount: r.token_count,
  }));
}

export async function getSampleChunks(ragId: number, limit = 15): Promise<ChunkRow[]> {
  const result = await pool.query(
    `SELECT id, source_id, document_id, source_type, heading, content, token_count
     FROM rag_chunks WHERE rag_id = $1
     ORDER BY RANDOM() LIMIT $2`,
    [ragId, limit]
  );
  return result.rows.map((r) => ({
    id: r.id, sourceId: r.source_id, documentId: r.document_id,
    sourceType: r.source_type, heading: r.heading, content: r.content, tokenCount: r.token_count,
  }));
}

export async function insertChunk(
  sourceId: string | null,
  documentId: number | null,
  sourceType: string,
  heading: string | null,
  content: string,
  embedding: number[] | null,
  tokenCount?: number,
  ragId?: number
): Promise<void> {
  if (embedding && pgvectorAvailable) {
    const embeddingStr = `[${embedding.join(',')}]`;
    await pool.query(
      `INSERT INTO rag_chunks (source_id, document_id, source_type, heading, content, embedding, token_count, rag_id)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)`,
      [sourceId, documentId, sourceType, heading, content, embeddingStr, tokenCount ?? null, ragId ?? null]
    );
  } else {
    await pool.query(
      `INSERT INTO rag_chunks (source_id, document_id, source_type, heading, content, token_count, rag_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sourceId, documentId, sourceType, heading, content, tokenCount ?? null, ragId ?? null]
    );
  }
}

export async function deleteChunksBySource(sourceId: string): Promise<void> {
  await pool.query('DELETE FROM rag_chunks WHERE source_id = $1', [sourceId]);
}

export async function deleteChunksByDocument(documentId: number): Promise<void> {
  await pool.query('DELETE FROM rag_chunks WHERE document_id = $1', [documentId]);
}

export async function getChunkStats(): Promise<{ totalChunks: number; totalSources: number }> {
  const result = await pool.query(`
    SELECT COUNT(*) AS total_chunks, COUNT(DISTINCT source_id) AS total_sources FROM rag_chunks
  `);
  return {
    totalChunks: parseInt(result.rows[0].total_chunks, 10),
    totalSources: parseInt(result.rows[0].total_sources, 10),
  };
}

export async function getBotChunkStats(ragId: number): Promise<{ totalChunks: number; totalDocuments: number }> {
  const result = await pool.query(
    `SELECT COUNT(c.id) AS total_chunks, COUNT(DISTINCT d.id) AS total_documents
     FROM rag_chunks c
     LEFT JOIN rag_documents d ON d.rag_id = $1
     WHERE c.rag_id = $1`,
    [ragId]
  );
  return {
    totalChunks: parseInt(result.rows[0].total_chunks, 10),
    totalDocuments: parseInt(result.rows[0].total_documents, 10),
  };
}

// ============ Sources (Confluence pages, URLs) ============

export async function upsertSource(id: string, sourceType: string, spaceKey?: string, url?: string): Promise<void> {
  await pool.query(
    `INSERT INTO rag_sources (id, source_type, space_key, url, indexed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET indexed_at = NOW()`,
    [id, sourceType, spaceKey ?? null, url ?? null]
  );
}

// ============ Documents ============

export async function insertDocument(
  name: string,
  sourceType: string,
  fileName: string,
  uploadedBy: number,
  chunkCount: number,
  ragId?: number
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO rag_documents (name, source_type, file_name, uploaded_by, chunk_count, rag_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, sourceType, fileName, uploadedBy, chunkCount, ragId ?? null]
  );
  return result.rows[0].id;
}

export async function deleteDocument(id: number): Promise<void> {
  await pool.query('DELETE FROM rag_documents WHERE id = $1', [id]);
}

export async function getDocuments(ragId?: number): Promise<{ id: number; name: string; sourceType: string; chunkCount: number; createdAt: string }[]> {
  const whereClause = ragId != null ? 'WHERE rag_id = $1' : 'WHERE rag_id IS NULL';
  const params = ragId != null ? [ragId] : [];
  const result = await pool.query(
    `SELECT id, name, source_type, chunk_count, created_at FROM rag_documents ${whereClause} ORDER BY created_at DESC`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id, name: r.name, sourceType: r.source_type,
    chunkCount: r.chunk_count, createdAt: r.created_at,
  }));
}

// ============ Confluence Spaces (global — legacy) ============

export async function getSelectedConfluenceSpaces(userId: number): Promise<{ spaceKey: string; spaceName: string }[]> {
  const result = await pool.query(
    `SELECT space_key, space_name FROM rag_user_confluence_spaces WHERE user_id = $1 ORDER BY space_key`,
    [userId]
  );
  return result.rows.map((r) => ({ spaceKey: r.space_key, spaceName: r.space_name }));
}

export async function saveSelectedConfluenceSpaces(userId: number, spaces: { key: string; name: string }[]): Promise<void> {
  await pool.query('DELETE FROM rag_user_confluence_spaces WHERE user_id = $1', [userId]);
  for (const space of spaces) {
    await pool.query(
      `INSERT INTO rag_user_confluence_spaces (user_id, space_key, space_name) VALUES ($1, $2, $3)`,
      [userId, space.key, space.name]
    );
  }
}

// ============ Confluence Spaces (per bot) ============

export async function getBotConfluenceSpaces(botId: number): Promise<{ spaceKey: string; spaceName: string }[]> {
  const result = await pool.query(
    `SELECT space_key, space_name FROM rag_bot_confluence_spaces WHERE bot_id = $1 ORDER BY space_key`,
    [botId]
  );
  return result.rows.map((r) => ({ spaceKey: r.space_key, spaceName: r.space_name }));
}

export async function saveBotConfluenceSpaces(botId: number, spaces: { key: string; name: string }[]): Promise<void> {
  await pool.query('DELETE FROM rag_bot_confluence_spaces WHERE bot_id = $1', [botId]);
  for (const space of spaces) {
    await pool.query(
      `INSERT INTO rag_bot_confluence_spaces (bot_id, space_key, space_name) VALUES ($1, $2, $3)`,
      [botId, space.key, space.name]
    );
  }
}
