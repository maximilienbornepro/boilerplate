/**
 * Outlook Collector Service
 *
 * Stores Outlook emails pushed from the Chrome extension (DOM scraping)
 * and exposes them as daily digests for the SuiviTess "Importer & ranger"
 * flow. Unlike Slack (which has a server-side API fetcher), Outlook
 * relies on the extension to scrape and push — no OAuth token needed.
 */

import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;
let pool: pg.Pool;

// ============ Types ============

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

// ============ Init ============

export async function initOutlookCollector(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

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

// ============ Store ============

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

// ============ Query ============

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

  return rows.map(mapMessage);
}

export async function getOutlookMessageCount(userId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int as count FROM outlook_messages WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.count ?? 0;
}

// ============ Grouping ============

/**
 * Group Outlook messages by day into digest items for the import modal.
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

// ============ Helpers ============

function parseOutlookDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Format "Lun 13/04/2026 12:26"
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
  if (match) return new Date(+match[3], +match[2] - 1, +match[1], +match[4], +match[5]);
  // ISO format
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

function mapMessage(row: Record<string, unknown>): OutlookMessage {
  return {
    id: row.id as number,
    userId: row.user_id as number,
    messageId: row.message_id as string,
    subject: row.subject as string,
    sender: row.sender as string,
    date: row.date ? (row.date as Date).toISOString() : '',
    preview: row.preview as string,
    body: row.body as string | null,
    collectedAt: (row.collected_at as Date).toISOString(),
  };
}
