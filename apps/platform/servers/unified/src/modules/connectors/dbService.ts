import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  try {
    await pool.query('SELECT 1');
    console.log('[Connectors] Database connected');
  } catch (err) {
    console.error('[Connectors] Database connection failed:', err);
    throw err;
  }

  // Auto-create AI usage tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      provider VARCHAR(20) NOT NULL,
      model VARCHAR(100),
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      module VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_logs(provider)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage_logs(created_at)');
}

// Types
export interface Connector {
  id: number;
  userId: number;
  service: string;
  config: Record<string, unknown>;
  isActive: boolean;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const SUPPORTED_SERVICES = ['jira', 'notion', 'clickup', 'fathom', 'anthropic', 'openai', 'mistral', 'scaleway'] as const;
export type ServiceType = typeof SUPPORTED_SERVICES[number];

function formatConnector(row: any): Connector {
  return {
    id: row.id,
    userId: row.user_id,
    service: row.service,
    config: row.config || {},
    isActive: row.is_active,
    lastTestedAt: row.last_tested_at ? row.last_tested_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Services whose config contains an API key/token that must be masked
const SENSITIVE_FIELD_MAP: Record<string, string[]> = {
  jira: ['apiToken'],
  notion: ['apiKey'],
  clickup: ['apiKey'],
  fathom: ['apiKey'],
  anthropic: ['apiKey'],
  openai: ['apiKey'],
  mistral: ['apiKey'],
  scaleway: ['apiKey'],
};

function maskValue(value: string): string {
  return value.length > 8
    ? value.substring(0, 4) + '****' + value.substring(value.length - 4)
    : '****';
}

// Sanitize config for response (mask sensitive fields)
export function sanitizeConfig(service: string, cfg: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...cfg };
  const fields = SENSITIVE_FIELD_MAP[service] ?? [];
  for (const field of fields) {
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = maskValue(sanitized[field] as string);
    }
  }
  return sanitized;
}

// ==================== CRUD ====================

export async function getConnectorsByUser(userId: number): Promise<Connector[]> {
  const result = await pool.query(
    'SELECT * FROM user_connectors WHERE user_id = $1 ORDER BY service',
    [userId]
  );
  return result.rows.map(formatConnector);
}

export async function getConnector(userId: number, service: string): Promise<Connector | null> {
  const result = await pool.query(
    'SELECT * FROM user_connectors WHERE user_id = $1 AND service = $2',
    [userId, service]
  );
  if (result.rows.length === 0) return null;
  return formatConnector(result.rows[0]);
}

export async function upsertConnector(
  userId: number,
  service: string,
  connectorConfig: Record<string, unknown>
): Promise<Connector> {
  const result = await pool.query(
    `INSERT INTO user_connectors (user_id, service, config, is_active)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (user_id, service) DO UPDATE SET
       config = $3,
       is_active = false,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, service, JSON.stringify(connectorConfig)]
  );
  return formatConnector(result.rows[0]);
}

export async function markConnectorTested(
  userId: number,
  service: string,
  isActive: boolean
): Promise<void> {
  await pool.query(
    `UPDATE user_connectors
     SET is_active = $3, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND service = $2`,
    [userId, service, isActive]
  );
}

export async function deleteConnector(userId: number, service: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM user_connectors WHERE user_id = $1 AND service = $2',
    [userId, service]
  );
  return (result.rowCount || 0) > 0;
}

// ==================== AI Usage Logging ====================

export async function logAIUsage(
  userId: number,
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  module?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_usage_logs (user_id, provider, model, tokens_in, tokens_out, module)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, provider, model, tokensIn, tokensOut, module ?? null]
    );
  } catch {
    // Silent fail — logging should never break the main flow
  }
}

export interface AIUsageSummary {
  provider: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  lastUsed: string | null;
}

export async function getAIUsageSummary(userId: number): Promise<AIUsageSummary[]> {
  const result = await pool.query(
    `SELECT
       provider,
       COALESCE(SUM(tokens_in), 0)::int AS total_tokens_in,
       COALESCE(SUM(tokens_out), 0)::int AS total_tokens_out,
       COUNT(*)::int AS total_calls,
       MAX(created_at) AS last_used
     FROM ai_usage_logs
     WHERE user_id = $1
     GROUP BY provider
     ORDER BY provider`,
    [userId]
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    provider: row.provider as string,
    totalTokensIn: row.total_tokens_in as number,
    totalTokensOut: row.total_tokens_out as number,
    totalCalls: row.total_calls as number,
    lastUsed: row.last_used ? (row.last_used as Date).toISOString() : null,
  }));
}

export async function getAIUsageByPeriod(userId: number, days: number = 30): Promise<AIUsageSummary[]> {
  const result = await pool.query(
    `SELECT
       provider,
       COALESCE(SUM(tokens_in), 0)::int AS total_tokens_in,
       COALESCE(SUM(tokens_out), 0)::int AS total_tokens_out,
       COUNT(*)::int AS total_calls,
       MAX(created_at) AS last_used
     FROM ai_usage_logs
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY provider
     ORDER BY provider`,
    [userId, days]
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    provider: row.provider as string,
    totalTokensIn: row.total_tokens_in as number,
    totalTokensOut: row.total_tokens_out as number,
    totalCalls: row.total_calls as number,
    lastUsed: row.last_used ? (row.last_used as Date).toISOString() : null,
  }));
}
