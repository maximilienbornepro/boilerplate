// Hourly cron : for each user with auto-import enabled, fetch fresh
// items from the integrations the user opted into (Fathom, Otter,
// Outlook, Gmail, Slack), run the existing CROSS-DOC pipeline
// (analyzeSourceForReviews) AGAINST the subset of docs the user has
// opted in as targets, and persist the resulting proposals in
// `suivitess_inbox_proposals` for human validation.
//
// The mental model matches what the user sees on the suivitess LIST
// page (DocumentSelector → Importer & ranger) :
//   - sources are user-level (integrations)
//   - target docs are user-opt-in (each suivitess can subscribe)
//   - the AI decides which doc each subject lands in
//
// Strictly READ-only on the suivitess documents : the cron NEVER
// inserts subjects/sections directly. Only the user, after reviewing
// in the inbox UI, can apply the proposals.
//
// No cap on per-run volume — if 200 sources are pending, all 200 get
// analysed (fail-soft per item, so a single bad source doesn't break
// the loop).

import * as db from './dbService.js';
import * as autoDb from './autoImportDbService.js';
import type { AutoImportSource, UserAutoImportSettings } from './autoImportDbService.js';
import { applySubjectUpdates, recordSourceImported, type PureSubjectUpdate } from './applySubjectUpdatesService.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TICK_INTERVAL_MS = ONE_HOUR_MS;
const MIN_RUN_INTERVAL_MS = 50 * 60 * 1000;

let started = false;

export function startAutoImportScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void tick().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[SuiVitess auto-import] first tick failed:', (err as Error).message);
    });
  }, 60_000);
  setInterval(() => {
    void tick().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[SuiVitess auto-import] tick failed:', (err as Error).message);
    });
  }, TICK_INTERVAL_MS);
  // eslint-disable-next-line no-console
  console.log(`[SuiVitess auto-import] scheduler started (tick every ${TICK_INTERVAL_MS / 60_000}min)`);
}

/** Body of one scheduler tick. Exported for tests / manual triggers. */
export async function tick(): Promise<{
  processedUsers: number;
  itemsAnalysed: number;
  itemsSkipped: number;
  errors: number;
}> {
  const t0 = Date.now();
  const stats = { processedUsers: 0, itemsAnalysed: 0, itemsSkipped: 0, errors: 0 };

  // Find every user that has at least ONE opted-in target doc AND a
  // user-settings row. The cron walks them. Users who never touched
  // the settings or whose master kill-switch is on are skipped.
  const candidates = await db.pool.query<{ user_id: number }>(
    `SELECT DISTINCT s.user_id
       FROM suivitess_user_settings s
      WHERE s.auto_import_disabled = FALSE
        AND COALESCE(array_length(s.auto_import_sources, 1), 0) > 0
        AND EXISTS (
          SELECT 1 FROM suivitess_auto_import_config c
           WHERE c.user_id = s.user_id AND c.enabled = TRUE
        )`,
  );

  for (const row of candidates.rows) {
    const userId = row.user_id;
    const settings = await autoDb.getUserSettings(userId);
    if (settings.masterDisabled) continue;
    if (settings.lastRunAt) {
      const elapsed = Date.now() - new Date(settings.lastRunAt).getTime();
      if (elapsed < MIN_RUN_INTERVAL_MS) continue;
    }
    stats.processedUsers++;
    try {
      const r = await runUserOnce(userId, settings);
      stats.itemsAnalysed += r.analysed;
      stats.itemsSkipped += r.skipped;
      await autoDb.recordUserRunResult(userId, true);
    } catch (err) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error(`[SuiVitess auto-import] user ${userId} failed:`, (err as Error).message);
      await autoDb.recordUserRunResult(userId, false, (err as Error).message?.slice(0, 500) ?? 'unknown');
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[SuiVitess auto-import] tick done in ${Date.now() - t0}ms — ${stats.processedUsers} user(s) · ${stats.itemsAnalysed} item(s) analysed · ${stats.itemsSkipped} skipped · ${stats.errors} error(s)`);
  return stats;
}

async function runUserOnce(
  userId: number,
  settings: UserAutoImportSettings,
): Promise<{ analysed: number; skipped: number }> {
  const subscribedDocIds = await autoDb.listEnabledTargetDocumentIds(userId);
  if (subscribedDocIds.length === 0) return { analysed: 0, skipped: 0 };

  // Process every enabled source IN PARALLEL — the bottleneck is the
  // AI calls (T1+T2+T3) per item, and they don't share state across
  // sources. Running fathom/outlook/slack concurrently turns the
  // first-tick wall-clock from N×source_time into max(source_times)
  // so users see proposals from ALL sources lighting up together
  // instead of waiting for fathom to finish first.
  const results = await Promise.all(
    settings.sources.map(source =>
      processSource(userId, source, subscribedDocIds)
        .catch(err => {
          // eslint-disable-next-line no-console
          console.warn(`[SuiVitess auto-import] source ${source} failed:`, (err as Error).message);
          return { analysed: 0, skipped: 0 };
        }),
    ),
  );
  return results.reduce(
    (acc, r) => ({ analysed: acc.analysed + r.analysed, skipped: acc.skipped + r.skipped }),
    { analysed: 0, skipped: 0 },
  );
}

async function processSource(
  userId: number,
  source: 'fathom' | 'otter' | 'outlook' | 'gmail' | 'slack',
  subscribedDocIds: string[],
): Promise<{ analysed: number; skipped: number }> {
  let analysed = 0;
  let skipped = 0;
  const items = await listNewSourceItems(userId, source);
  for (const item of items) {
    try {
      const exists = await autoDb.inboxProposalAlreadyExistsForUser(
        userId, source, item.id,
      );
      if (exists) { skipped++; continue; }

      const transcript = await fetchSourceContent(userId, source, item.id);
      if (!transcript || !transcript.trim()) { skipped++; continue; }

      const proposals = await analyseSource({
        userId,
        source,
        sourceTitle: item.title,
        transcript,
        subscribedDocIds,
      });
      if (proposals.proposals.length === 0) {
        skipped++;
        continue;
      }

      // UX rule : updates of existing subjects need NO human validation.
      // Apply them silently here, then queue the inbox row only with
      // what's left for the user (new subjects / new sections / new
      // reviews). If nothing remains, no inbox row is created — but we
      // still tag the source as imported so we don't re-analyse it next
      // tick.
      const all = proposals.proposals as Array<{
        title?: string;
        targetSubjectId?: string | null;
        subjectAction?: 'new-subject' | 'update-existing-subject';
        updatedSituation?: string | null;
        updatedStatus?: string | null;
        updatedResponsibility?: string | null;
        reviewId?: string | null;
        targetReviewId?: string | null;
      }>;
      const auto: PureSubjectUpdate[] = [];
      const manual: typeof all = [];
      for (const p of all) {
        if (p.subjectAction === 'update-existing-subject' && p.targetSubjectId) {
          auto.push({
            title: p.title ?? '(untitled)',
            targetSubjectId: p.targetSubjectId,
            updatedSituation: p.updatedSituation ?? null,
            updatedStatus: p.updatedStatus ?? null,
            updatedResponsibility: p.updatedResponsibility ?? null,
          });
        } else {
          manual.push(p);
        }
      }

      let autoTouchedReviewIds = new Set<string>();
      if (auto.length > 0) {
        const r = await applySubjectUpdates(userId, auto);
        autoTouchedReviewIds = r.touchedReviewIds;
        if (r.errors.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[SuiVitess auto-import] ${r.errors.length} subject-update(s) failed for ${source}:${item.id}`,
            r.errors,
          );
        }
      }

      if (manual.length === 0) {
        // Pure-update item — no inbox row, just bookkeep so it never
        // re-appears next tick.
        await recordSourceImported(autoTouchedReviewIds, source, item.id, item.title);
        analysed++;
        continue;
      }

      const docCounts = new Map<string, number>();
      for (const p of manual) {
        const r = p.reviewId ?? p.targetReviewId ?? null;
        if (r) docCounts.set(r, (docCounts.get(r) ?? 0) + 1);
      }
      const primaryDocId = [...docCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        ?? subscribedDocIds[0];
      await autoDb.insertInboxProposal({
        userId,
        documentId: primaryDocId,
        sourceKind: source,
        sourceId: item.id,
        sourceTitle: item.title,
        sourceDate: item.date ?? null,
        proposals: manual,
        aiLogId: proposals.rootLogId,
      });
      // Also tag every doc that received a silent update so dedup is
      // strict on the next tick (the inbox row alone covers the
      // primary doc, but updates may have hit other reviews).
      if (autoTouchedReviewIds.size > 0) {
        await recordSourceImported(autoTouchedReviewIds, source, item.id, item.title);
      }
      analysed++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[SuiVitess auto-import] item ${source}:${item.id} failed:`, (err as Error).message);
      skipped++;
    }
  }
  return { analysed, skipped };
}

interface SourceItem {
  id: string;
  title: string;
  date: string | null;
}

async function listNewSourceItems(userId: number, source: AutoImportSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  if (source === 'fathom') {
    const { listFathomCalls } = await import('./fathomService.js');
    const calls = await listFathomCalls(userId, 30);
    for (const c of calls) items.push({ id: c.id, title: c.title, date: c.date ?? null });
  } else if (source === 'otter') {
    const { listOtterCalls } = await import('./otterService.js');
    const calls = await listOtterCalls(userId, 30);
    for (const c of calls) items.push({ id: c.id, title: c.title, date: (c as { date?: string | null }).date ?? null });
  } else if (source === 'outlook') {
    const { getOutlookMessages, groupOutlookMessagesByDay } = await import('./outlookCollectorService.js');
    const msgs = await getOutlookMessages(userId, { days: 14, excludeImported: false });
    if (msgs.length > 0) {
      const digests = groupOutlookMessagesByDay(msgs);
      for (const d of digests) items.push({ id: d.id, title: d.title, date: d.date ?? null });
    }
  } else if (source === 'gmail') {
    const { listGmailEmails } = await import('./emailService.js');
    const emails = await listGmailEmails(userId, 14);
    for (const e of emails) {
      items.push({ id: e.id, title: `${e.subject} (${e.sender})`, date: (e as { date?: string | null }).date ?? null });
    }
  } else if (source === 'slack') {
    const { getSlackConfig, getSlackMessages, groupSlackMessagesByDay } = await import('./slackCollectorService.js');
    const slackConfig = await getSlackConfig(userId);
    if (!slackConfig?.isActive) return items;
    const msgs = await getSlackMessages(slackConfig.id, { days: 14 });
    if (msgs.length > 0) {
      const digests = groupSlackMessagesByDay(msgs);
      for (const d of digests) items.push({ id: d.id, title: d.title, date: d.date ?? null });
    }
  }
  return items;
}

async function fetchSourceContent(
  userId: number,
  source: AutoImportSource,
  id: string,
): Promise<string> {
  if (source === 'fathom') {
    const { getFathomTranscript } = await import('./fathomService.js');
    const entries = await getFathomTranscript(userId, id);
    return entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
  }
  if (source === 'otter') {
    const { getOtterTranscript } = await import('./otterService.js');
    const entries = await getOtterTranscript(userId, id);
    return entries.map(e => `[${e.speaker}]: ${e.text}`).join('\n');
  }
  if (source === 'outlook') {
    if (id.startsWith('outlook:')) {
      const dateFilter = id.replace('outlook:', '');
      const { getOutlookMessages } = await import('./outlookCollectorService.js');
      const msgs = await getOutlookMessages(
        userId,
        dateFilter && dateFilter !== 'unknown' ? { dateFilter } : { days: 30 },
      );
      const filtered = dateFilter && dateFilter !== 'unknown'
        ? msgs.filter(m => m.date.slice(0, 10) === dateFilter)
        : msgs;
      return filtered
        .map(m => `=== Mail de ${m.sender} ===\nObjet: ${m.subject}\n\n${m.body || m.preview}\n`)
        .join('\n');
    }
    const { getOutlookEmailBody } = await import('./emailService.js');
    return getOutlookEmailBody(userId, id);
  }
  if (source === 'gmail') {
    const { getGmailEmailBody } = await import('./emailService.js');
    return getGmailEmailBody(userId, id);
  }
  if (source === 'slack') {
    const { getSlackConfig, getSlackMessages, formatSlackMessagesForAI } = await import('./slackCollectorService.js');
    const cfg = await getSlackConfig(userId);
    if (!cfg) return '';
    const parts = id.split(':');
    const channelId = parts[1] || parts[0];
    const dateFilter = parts[2];
    const messages = await getSlackMessages(cfg.id, { days: cfg.daysToFetch, channelId });
    const filtered = dateFilter
      ? messages.filter(m => {
          const d = new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10);
          return d === dateFilter;
        })
      : messages;
    return formatSlackMessagesForAI(filtered);
  }
  return '';
}

/** Run the cross-doc pipeline against the user's subscribed docs only.
 *  This is the same code path the bulk modal uses on the LIST page —
 *  the AI sees only opted-in docs as candidates and decides per
 *  subject. */
async function analyseSource(input: {
  userId: number;
  source: AutoImportSource;
  sourceTitle: string;
  transcript: string;
  subscribedDocIds: string[];
}): Promise<{ proposals: unknown[]; rootLogId: number | null }> {
  const { analyzeSourceForReviews } = await import('../aiSkills/analyzeSourcePipeline.js');
  const { buildReviewsSnapshotForAI } = await import('./reviewSnapshotBuilder.js');
  const allReviews = await buildReviewsSnapshotForAI({
    userId: input.userId,
    isAdmin: false,
    db,
  });
  // Pre-filter : only the user's opted-in docs are candidates. The
  // AI literally sees nothing else, so there's no risk of routing
  // to a doc that hasn't subscribed.
  const subscribed = new Set(input.subscribedDocIds);
  const reviews = allReviews.filter(r => subscribed.has(r.id));
  if (reviews.length === 0) {
    return { proposals: [], rootLogId: null };
  }
  const { proposals, rootLogId } = await analyzeSourceForReviews({
    sourceKind: (input.source === 'fathom' || input.source === 'otter')
      ? input.source
      : (input.source === 'slack' ? 'slack' : input.source === 'outlook' ? 'outlook' : 'gmail'),
    sourceRaw: input.transcript,
    sourceTitle: input.sourceTitle,
    reviews,
    userId: input.userId,
    userEmail: '',
  });
  return { proposals: proposals as unknown as unknown[], rootLogId };
}
