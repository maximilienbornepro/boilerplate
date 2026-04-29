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
  // Lift the sender length cap — Outlook lists every recipient on a
  // multi-CC mail in a single string ("Foo; Bar; Baz; …") that easily
  // crosses 200 chars, and the INSERT was silently failing on those
  // rows (caught + dropped by storeOutlookEmails). Idempotent ALTER,
  // safe to run on every boot.
  await pool.query("ALTER TABLE outlook_messages ALTER COLUMN sender TYPE TEXT");
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
): Promise<{ stored: number; skipped: number; errors: Array<{ messageId: string; reason: string }> }> {
  let stored = 0;
  let skipped = 0;
  const errors: Array<{ messageId: string; reason: string }> = [];
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
    } catch (err) {
      // Surface the failure so a future regression doesn't repeat the
      // 200-char sender truncation drama (was silently dropping every
      // multi-CC mail because the catch was empty). Errors are bubbled
      // back to /outlook/sync → popup → user.
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[outlook-collector] insert failed for ${e.id}: ${reason}`);
      errors.push({ messageId: e.id, reason: reason.slice(0, 200) });
      skipped++;
    }
  }
  return { stored, skipped, errors };
}

// ============ Query ============

export async function getOutlookMessages(
  userId: number,
  opts: { days?: number; excludeImported?: boolean; dateFilter?: string | null },
): Promise<OutlookMessage[]> {
  const conditions = ['om.user_id = $1'];
  const params: unknown[] = [userId];

  // `dateFilter` (YYYY-MM-DD) — when fetching the content of a specific
  // daily digest we want EVERY mail of that day, not the most recent
  // 200 across the whole window. Filtering in SQL bypasses the
  // global LIMIT cap that was silently dropping older days when the
  // user had a busy mailbox (typical symptom : "EAD / contrôle
  // parental" mails missing from the digest the IA analysed).
  if (opts.dateFilter) {
    params.push(opts.dateFilter);
    conditions.push(`om.date::date = $${params.length}::date`);
  } else if (opts.days) {
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

  // Cap : tight when filtering by date (~all mails of one day),
  // generous otherwise so the bulk-source list isn't artificially
  // capped at 200 mails of which only a tiny window is visible.
  const limit = opts.dateFilter ? 500 : 1000;

  const { rows } = await pool.query(
    `SELECT om.* FROM outlook_messages om
     ${excludeJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY om.date DESC
     LIMIT ${limit}`,
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

/**
 * Best-effort parse of the various date formats Outlook web shows on
 * a mail row. Listed from most precise to most ambiguous :
 *
 *   1. "Lun 13/04/2026 12:26"           — full title attribute
 *   2. ISO 8601 anything `new Date()` understands
 *   3. "Hier 14:30" / "Hier"            — yesterday at the given time
 *   4. "Aujourd'hui 09:12" / "Aujourd'hui" — today at the given time
 *   5. Bare time like "14:30"            — today at that time
 *
 * Falls back to `new Date()` only when none of the above match.
 * Previously every relative format silently fell back to `new Date()`,
 * so all of yesterday's mails were stamped as "today" at server clock,
 * which broke the per-day digest grouping.
 */
export function parseOutlookDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // 1. Full date "Lun 13/04/2026 12:26"
  const fullMatch = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
  if (fullMatch) return new Date(+fullMatch[3], +fullMatch[2] - 1, +fullMatch[1], +fullMatch[4], +fullMatch[5]);

  // 2. ISO / RFC anything Date() can parse natively (e.g. "2026-04-29T14:30:00Z").
  if (/[-T:]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  const lower = s.toLowerCase();
  const timeMatch = s.match(/(\d{1,2}):(\d{2})/);
  const now = new Date();

  // 3. "Hier" — yesterday, optionally with a time. We default the
  // hour to local noon (not midnight) when missing so that a
  // negative-offset timezone (server UTC, user CEST) doesn't push
  // the row back to the day-before in UTC.
  if (lower.startsWith('hier')) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    if (timeMatch) d.setHours(+timeMatch[1], +timeMatch[2], 0, 0);
    else d.setHours(12, 0, 0, 0);
    return d;
  }

  // 4. "Aujourd'hui" — today, optionally with a time.
  if (lower.startsWith("aujourd")) {
    const d = new Date(now);
    if (timeMatch) d.setHours(+timeMatch[1], +timeMatch[2], 0, 0);
    return d;
  }

  // 5. Bare time "14:30" — today at that time. (Outlook drops the
  // date label for very recent mails of the current day.)
  if (/^\d{1,2}:\d{2}$/.test(s) && timeMatch) {
    const d = new Date(now);
    d.setHours(+timeMatch[1], +timeMatch[2], 0, 0);
    return d;
  }

  // Last resort — give it to Date() and accept whatever, otherwise stamp
  // as now so the row at least makes it into the table (we'd rather
  // mis-date than drop entirely).
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
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
