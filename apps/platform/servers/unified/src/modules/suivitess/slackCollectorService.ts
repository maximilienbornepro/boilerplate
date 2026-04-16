/**
 * Slack Collector Service
 *
 * Fetches channel history from Slack's web API using user-provided cookies
 * (xoxc token + xoxd cookie). Runs on a configurable interval (default 60 min)
 * and stores messages in a local DB table for later import into SuiviTess.
 *
 * This service works on both local dev and production servers — it makes
 * standard HTTP requests, no browser or Puppeteer needed.
 */

import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;
let pool: pg.Pool;

// ============ Types ============

export interface SlackConfig {
  id: number;
  userId: number;
  workspaceUrl: string;
  xoxcToken: string;
  xoxdCookie: string;
  channels: Array<{ id: string; name: string; url?: string }>;
  daysToFetch: number;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  isActive: boolean;
}

export interface SlackMessage {
  id: number;
  configId: number;
  channelId: string;
  channelName: string | null;
  messageTs: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  threadTs: string | null;
  hasFiles: boolean;
  collectedAt: string;
}

// ============ Init ============

export async function initSlackCollector(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Auto-create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slack_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_url TEXT NOT NULL,
      xoxc_token TEXT NOT NULL,
      xoxd_cookie TEXT NOT NULL,
      channels JSONB DEFAULT '[]',
      days_to_fetch INTEGER DEFAULT 7,
      sync_interval_minutes INTEGER DEFAULT 60,
      last_sync_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS slack_messages (
      id SERIAL PRIMARY KEY,
      config_id INTEGER NOT NULL REFERENCES slack_configs(id) ON DELETE CASCADE,
      channel_id VARCHAR(20) NOT NULL,
      channel_name VARCHAR(100),
      message_ts VARCHAR(30) NOT NULL,
      sender_id VARCHAR(20),
      sender_name VARCHAR(100),
      text TEXT NOT NULL,
      thread_ts VARCHAR(30),
      has_files BOOLEAN DEFAULT false,
      collected_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(channel_id, message_ts)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id, message_ts)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_slack_messages_config ON slack_messages(config_id)');

  console.log('[Slack Collector] Initialized');

  // Start hourly sync
  scheduleSync();
}

// ============ Slack API helpers ============

interface SlackApiMessage {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  files?: unknown[];
  subtype?: string;
}

/** Cache: user_id → display_name. Shared across all fetches in a single sync cycle. */
const userNameCache = new Map<string, string>();

async function slackApiFetch(
  workspaceUrl: string,
  method: string,
  body: Record<string, string>,
  xoxcToken: string,
  xoxdCookie: string,
): Promise<unknown> {
  const baseUrl = workspaceUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ token: xoxcToken, ...body });

  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `d=${xoxdCookie}`,
    },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Slack API ${method}: HTTP ${res.status}`);
  const data = await res.json() as { ok: boolean; error?: string; [key: string]: unknown };
  if (!data.ok) throw new Error(`Slack API ${method}: ${data.error || 'unknown error'}`);
  return data;
}

async function resolveUserName(
  workspaceUrl: string,
  userId: string,
  xoxcToken: string,
  xoxdCookie: string,
): Promise<string> {
  if (!userId) return 'Inconnu';
  const cached = userNameCache.get(userId);
  if (cached) return cached;

  try {
    const data = await slackApiFetch(workspaceUrl, 'users.info', { user: userId }, xoxcToken, xoxdCookie) as {
      user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } };
    };
    const name = data.user?.profile?.display_name
      || data.user?.real_name
      || data.user?.profile?.real_name
      || userId;
    userNameCache.set(userId, name);
    return name;
  } catch {
    userNameCache.set(userId, userId);
    return userId;
  }
}

// ============ Core: fetch channel history ============

export async function fetchChannelHistory(
  cfg: SlackConfig,
  channelId: string,
  channelName: string,
  oldestTs: number, // Unix epoch seconds
): Promise<{ collected: number; skipped: number }> {
  let collected = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let hasMore = true;
  const MAX_PAGES = 20; // Safety limit
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    page++;
    const params: Record<string, string> = {
      channel: channelId,
      limit: '200',
      oldest: String(oldestTs),
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApiFetch(
      cfg.workspaceUrl, 'conversations.history', params,
      cfg.xoxcToken, cfg.xoxdCookie,
    ) as {
      messages?: SlackApiMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    };

    for (const msg of (data.messages || [])) {
      if (!msg.text || msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') continue;

      const senderName = msg.user
        ? await resolveUserName(cfg.workspaceUrl, msg.user, cfg.xoxcToken, cfg.xoxdCookie)
        : 'Bot';

      try {
        await pool.query(
          `INSERT INTO slack_messages (config_id, channel_id, channel_name, message_ts, sender_id, sender_name, text, thread_ts, has_files)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (channel_id, message_ts) DO UPDATE SET
             text = EXCLUDED.text,
             sender_name = EXCLUDED.sender_name,
             has_files = EXCLUDED.has_files`,
          [
            cfg.id, channelId, channelName, msg.ts,
            msg.user || null, senderName,
            msg.text, msg.thread_ts || null,
            !!(msg.files && msg.files.length > 0),
          ],
        );
        collected++;
      } catch {
        skipped++;
      }

      // Fetch thread replies if this message has a thread
      if (msg.thread_ts && msg.thread_ts === msg.ts) {
        try {
          const threadResult = await fetchThreadReplies(cfg, channelId, channelName, msg.ts);
          collected += threadResult.collected;
          skipped += threadResult.skipped;
        } catch {
          // Non-blocking — thread fetch failure shouldn't stop the main flow
        }
      }
    }

    hasMore = !!data.has_more;
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) hasMore = false;
  }

  return { collected, skipped };
}

/**
 * Fetch all replies in a thread. Each reply is stored as a separate message
 * with `thread_ts` pointing to the parent, so the transcript builder can
 * reconstruct the conversation hierarchy.
 */
async function fetchThreadReplies(
  cfg: SlackConfig,
  channelId: string,
  channelName: string,
  threadTs: string,
): Promise<{ collected: number; skipped: number }> {
  let collected = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < 5) {
    page++;
    const params: Record<string, string> = {
      channel: channelId,
      ts: threadTs,
      limit: '200',
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApiFetch(
      cfg.workspaceUrl, 'conversations.replies', params,
      cfg.xoxcToken, cfg.xoxdCookie,
    ) as {
      messages?: SlackApiMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    };

    for (const msg of (data.messages || [])) {
      // Skip the parent message (already stored) — it has ts === thread_ts
      if (msg.ts === threadTs) continue;
      if (!msg.text || msg.subtype === 'channel_join') continue;

      const senderName = msg.user
        ? await resolveUserName(cfg.workspaceUrl, msg.user, cfg.xoxcToken, cfg.xoxdCookie)
        : 'Bot';

      try {
        await pool.query(
          `INSERT INTO slack_messages (config_id, channel_id, channel_name, message_ts, sender_id, sender_name, text, thread_ts, has_files)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (channel_id, message_ts) DO UPDATE SET
             text = EXCLUDED.text,
             sender_name = EXCLUDED.sender_name,
             has_files = EXCLUDED.has_files`,
          [
            cfg.id, channelId, channelName, msg.ts,
            msg.user || null, senderName,
            msg.text, threadTs,
            !!(msg.files && msg.files.length > 0),
          ],
        );
        collected++;
      } catch {
        skipped++;
      }
    }

    hasMore = !!data.has_more;
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) hasMore = false;
  }

  return { collected, skipped };
}

// ============ Config CRUD ============

export async function getSlackConfig(userId: number): Promise<SlackConfig | null> {
  const { rows } = await pool.query(
    'SELECT * FROM slack_configs WHERE user_id = $1', [userId],
  );
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function upsertSlackConfig(
  userId: number,
  data: {
    workspaceUrl: string;
    xoxcToken: string;
    xoxdCookie: string;
    channels: Array<{ id: string; name: string; url?: string }>;
    daysToFetch?: number;
    syncIntervalMinutes?: number;
  },
): Promise<SlackConfig> {
  const { rows } = await pool.query(
    `INSERT INTO slack_configs (user_id, workspace_url, xoxc_token, xoxd_cookie, channels, days_to_fetch, sync_interval_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       workspace_url = EXCLUDED.workspace_url,
       xoxc_token = EXCLUDED.xoxc_token,
       xoxd_cookie = EXCLUDED.xoxd_cookie,
       channels = EXCLUDED.channels,
       days_to_fetch = EXCLUDED.days_to_fetch,
       sync_interval_minutes = EXCLUDED.sync_interval_minutes,
       is_active = true,
       updated_at = NOW()
     RETURNING *`,
    [
      userId, data.workspaceUrl, data.xoxcToken, data.xoxdCookie,
      JSON.stringify(data.channels),
      data.daysToFetch ?? 7,
      data.syncIntervalMinutes ?? 60,
    ],
  );
  return mapConfig(rows[0]);
}

export async function deleteSlackConfig(userId: number): Promise<void> {
  await pool.query('DELETE FROM slack_configs WHERE user_id = $1', [userId]);
}

export async function testSlackAuth(
  workspaceUrl: string,
  xoxcToken: string,
  xoxdCookie: string,
): Promise<{ ok: boolean; user?: string; team?: string; error?: string }> {
  try {
    const data = await slackApiFetch(workspaceUrl, 'auth.test', {}, xoxcToken, xoxdCookie) as {
      user?: string;
      team?: string;
    };
    return { ok: true, user: data.user as string, team: data.team as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ============ Messages ============

export async function getSlackMessages(
  configId: number,
  opts: { days?: number; channelId?: string; excludeImportedFor?: number },
): Promise<SlackMessage[]> {
  const conditions = ['sm.config_id = $1'];
  const params: unknown[] = [configId];
  let idx = 2;

  if (opts.days) {
    conditions.push(`sm.collected_at >= NOW() - INTERVAL '${Math.min(60, opts.days)} days'`);
  }
  if (opts.channelId) {
    conditions.push(`sm.channel_id = $${idx++}`);
    params.push(opts.channelId);
  }

  // Exclude messages already imported into SuiviTess
  let excludeJoin = '';
  if (opts.excludeImportedFor) {
    excludeJoin = `
      LEFT JOIN suivitess_transcript_imports sti
        ON sti.call_id = (sm.channel_id || '/' || sm.message_ts)
        AND sti.provider = 'slack-collector'
    `;
    conditions.push('sti.id IS NULL');
  }

  const { rows } = await pool.query(
    `SELECT sm.* FROM slack_messages sm
     ${excludeJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY sm.message_ts DESC
     LIMIT 500`,
    params,
  );

  return rows.map(mapMessage);
}

export async function getSlackMessageCount(configId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int as count FROM slack_messages WHERE config_id = $1',
    [configId],
  );
  return rows[0]?.count ?? 0;
}

// ============ Sync ============

async function getActiveConfigs(): Promise<SlackConfig[]> {
  const { rows } = await pool.query(
    'SELECT * FROM slack_configs WHERE is_active = true',
  );
  return rows.map(mapConfig);
}

export async function syncConfig(cfg: SlackConfig): Promise<{ total: number }> {
  const oldestTs = Math.floor(Date.now() / 1000) - (cfg.daysToFetch * 24 * 60 * 60);
  let total = 0;

  for (const ch of cfg.channels) {
    try {
      const { collected } = await fetchChannelHistory(cfg, ch.id, ch.name, oldestTs);
      total += collected;
    } catch (err) {
      console.error(`[Slack Collector] Failed to fetch ${ch.name}:`, (err as Error).message);
    }
  }

  await pool.query(
    'UPDATE slack_configs SET last_sync_at = NOW() WHERE id = $1',
    [cfg.id],
  );

  return { total };
}

export async function syncNow(userId: number): Promise<{ total: number }> {
  const cfg = await getSlackConfig(userId);
  if (!cfg || !cfg.isActive) throw new Error('Aucune configuration Slack active');
  return syncConfig(cfg);
}

function scheduleSync(): void {
  // Run every 15 minutes — each config has its own interval check
  setInterval(async () => {
    try {
      const configs = await getActiveConfigs();
      for (const cfg of configs) {
        // Check if enough time has passed since last sync
        if (cfg.lastSyncAt) {
          const elapsed = Date.now() - new Date(cfg.lastSyncAt).getTime();
          if (elapsed < cfg.syncIntervalMinutes * 60 * 1000) continue;
        }
        console.log(`[Slack Collector] Auto-sync for user ${cfg.userId}...`);
        try {
          const { total } = await syncConfig(cfg);
          console.log(`[Slack Collector] Synced ${total} messages for user ${cfg.userId}`);
        } catch (err) {
          console.error(`[Slack Collector] Sync failed for user ${cfg.userId}:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error('[Slack Collector] Scheduler error:', (err as Error).message);
    }
  }, 15 * 60 * 1000); // check every 15 minutes
}

// ============ Mappers ============

function mapConfig(row: Record<string, unknown>): SlackConfig {
  return {
    id: row.id as number,
    userId: row.user_id as number,
    workspaceUrl: row.workspace_url as string,
    xoxcToken: row.xoxc_token as string,
    xoxdCookie: row.xoxd_cookie as string,
    channels: (row.channels || []) as SlackConfig['channels'],
    daysToFetch: (row.days_to_fetch as number) ?? 7,
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    lastSyncAt: row.last_sync_at ? (row.last_sync_at as Date).toISOString() : null,
    isActive: row.is_active as boolean,
  };
}

function mapMessage(row: Record<string, unknown>): SlackMessage {
  return {
    id: row.id as number,
    configId: row.config_id as number,
    channelId: row.channel_id as string,
    channelName: row.channel_name as string | null,
    messageTs: row.message_ts as string,
    senderId: row.sender_id as string | null,
    senderName: row.sender_name as string | null,
    text: row.text as string,
    threadTs: row.thread_ts as string | null,
    hasFiles: row.has_files as boolean,
    collectedAt: (row.collected_at as Date).toISOString(),
  };
}

/**
 * Parse a Slack channel URL to extract the channel ID.
 * Example: https://app.slack.com/client/T0NQT20US/C8TF1EZ6X → C8TF1EZ6X
 */
export function parseSlackChannelUrl(url: string): string | null {
  const match = url.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
  return match ? match[1] : null;
}

// ============================================================
//  OUTLOOK COLLECTOR (scraped via Chrome extension)
// ============================================================
// Unlike Slack (which uses cookies + web API for server-side fetch),
// Outlook emails are scraped by the Chrome extension and pushed to
// the server via POST /outlook/sync. The server stores them in
// outlook_messages and groups them by day for the bulk import flow.

export interface OutlookMessage {
  id: number;
  userId: number;
  messageId: string;   // Outlook's convId
  subject: string;
  sender: string;
  date: string;
  preview: string;
  body: string | null;
  collectedAt: string;
}

export async function initOutlookCollector(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outlook_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      sender VARCHAR(200),
      date TIMESTAMPTZ,
      preview TEXT,
      body TEXT,
      collected_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, message_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_outlook_messages_user ON outlook_messages(user_id, date DESC)');
  console.log('[Outlook Collector] Initialized');
}

/**
 * Store emails pushed from the Chrome extension.
 * Upserts on (user_id, message_id) so re-syncing is safe.
 */
export async function storeOutlookEmails(
  userId: number,
  emails: Array<{
    id: string;
    subject: string;
    sender: string;
    date: string;
    preview: string;
    body?: string;
  }>,
): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;
  for (const e of emails) {
    try {
      const parsedDate = parseOutlookDate(e.date);
      await pool.query(
        `INSERT INTO outlook_messages (user_id, message_id, subject, sender, date, preview, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, message_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           preview = EXCLUDED.preview,
           body = COALESCE(EXCLUDED.body, outlook_messages.body)`,
        [userId, e.id, e.subject, e.sender, parsedDate, e.preview?.slice(0, 500) || '', e.body || null],
      );
      stored++;
    } catch {
      skipped++;
    }
  }
  return { stored, skipped };
}

export async function getOutlookMessages(
  userId: number,
  opts: { days?: number; excludeImported?: boolean },
): Promise<OutlookMessage[]> {
  const conditions = ['om.user_id = $1'];
  const params: unknown[] = [userId];

  if (opts.days) {
    conditions.push(`om.date >= NOW() - INTERVAL '${Math.min(60, opts.days)} days'`);
  }

  let excludeJoin = '';
  if (opts.excludeImported) {
    excludeJoin = `
      LEFT JOIN suivitess_transcript_imports sti
        ON sti.call_id = ('outlook:' || om.message_id)
        AND sti.provider = 'outlook-collector'
    `;
    conditions.push('sti.id IS NULL');
  }

  const { rows } = await pool.query(
    `SELECT om.* FROM outlook_messages om
     ${excludeJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY om.date DESC
     LIMIT 200`,
    params,
  );

  return rows.map(r => ({
    id: r.id as number,
    userId: r.user_id as number,
    messageId: r.message_id as string,
    subject: r.subject as string,
    sender: r.sender as string,
    date: r.date ? (r.date as Date).toISOString() : '',
    preview: r.preview as string,
    body: r.body as string | null,
    collectedAt: (r.collected_at as Date).toISOString(),
  }));
}

export async function getOutlookMessageCount(userId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int as count FROM outlook_messages WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Group Outlook messages by day into digest items, same pattern as Slack.
 */
export function groupOutlookMessagesByDay(
  messages: OutlookMessage[],
): Array<{
  id: string;
  provider: 'outlook';
  title: string;
  date: string;
  preview: string;
  participants: string[];
}> {
  const groups = new Map<string, OutlookMessage[]>();

  for (const m of messages) {
    const dateStr = m.date ? m.date.slice(0, 10) : 'unknown';
    const group = groups.get(dateStr) || [];
    group.push(m);
    groups.set(dateStr, group);
  }

  const items: Array<{
    id: string;
    provider: 'outlook';
    title: string;
    date: string;
    preview: string;
    participants: string[];
  }> = [];

  for (const [dateStr, msgs] of groups) {
    const participants = [...new Set(msgs.map(m => m.sender).filter(Boolean))];
    const dateLabel = dateStr !== 'unknown'
      ? new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : 'Date inconnue';

    const preview = msgs
      .slice(0, 5)
      .map(m => `${m.sender}: ${m.subject}`)
      .join('\n');

    items.push({
      id: `outlook:${dateStr}`,
      provider: 'outlook',
      title: `Outlook — ${dateLabel} (${msgs.length} mail${msgs.length > 1 ? 's' : ''})`,
      date: dateStr + 'T12:00:00.000Z',
      preview,
      participants,
    });
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

function parseOutlookDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Format "Lun 13/04/2026 12:26"
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1], +match[4], +match[5]);
  // ISO format
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}
