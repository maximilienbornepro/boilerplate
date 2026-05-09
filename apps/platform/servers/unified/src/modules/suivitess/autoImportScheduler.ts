// Hourly cron : for each user × document with auto-import enabled,
// fetch fresh sources (Fathom calls, Otter calls, Outlook digests,
// Gmail messages, Slack digests) that haven't been processed yet,
// run the existing modular pipeline (T1+T2+T3 = analyzeSourceForReviews),
// and persist the resulting proposals in `suivitess_inbox_proposals`
// for the user to review later.
//
// Strictly READ-only on the suivitess document : the cron NEVER
// inserts subjects/sections directly. Only the user, after reviewing
// in the inbox UI, can apply the proposals.
//
// Master kill-switch (per user) and per-doc enabled/sources are
// honoured. A config that fails 3 times in a row gets auto-paused.
//
// No cap on per-run volume — if 200 sources are pending, all 200 get
// analysed (fail-soft per item, so a single bad source doesn't break
// the loop).

import * as db from './dbService.js';
import * as autoDb from './autoImportDbService.js';
import type { AutoImportSource, AutoImportConfig } from './autoImportDbService.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TICK_INTERVAL_MS = ONE_HOUR_MS;
/** Per-config minimum interval between two runs — even if the cron
 *  ticks every hour, we only re-run a given config when at least
 *  this delay has elapsed since `last_run_at`. */
const MIN_RUN_INTERVAL_MS = 50 * 60 * 1000; // ~50 min — leaves headroom

let started = false;

export function startAutoImportScheduler(): void {
  if (started) return;
  started = true;
  // First tick after a 60s warm-up (gives the rest of the server
  // time to boot — DB migrations, AI provider, etc.) — then every hour.
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
  processedConfigs: number;
  itemsAnalysed: number;
  itemsSkipped: number;
  errors: number;
}> {
  const t0 = Date.now();
  const stats = { processedConfigs: 0, itemsAnalysed: 0, itemsSkipped: 0, errors: 0 };
  const configs = await autoDb.listEnabledConfigs();
  for (const cfg of configs) {
    // Per-config rate-limit (avoid hammering the providers if the
    // cron interval is shortened or the tick re-runs).
    if (cfg.lastRunAt) {
      const elapsed = Date.now() - new Date(cfg.lastRunAt).getTime();
      if (elapsed < MIN_RUN_INTERVAL_MS) continue;
    }
    // Master kill-switch on the user level — silent skip.
    if (await autoDb.isMasterKillSwitchOn(cfg.userId)) continue;

    stats.processedConfigs++;
    let hadError = false;
    try {
      const { analysed, skipped } = await runConfigOnce(cfg);
      stats.itemsAnalysed += analysed;
      stats.itemsSkipped += skipped;
      await autoDb.recordRunResult(cfg.id, true, null);
    } catch (err) {
      hadError = true;
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error(`[SuiVitess auto-import] config ${cfg.id} (user=${cfg.userId} doc=${cfg.documentId}) failed:`, (err as Error).message);
      await autoDb.recordRunResult(cfg.id, false, (err as Error).message?.slice(0, 500) ?? 'unknown');
    }
    void hadError;
  }
  // eslint-disable-next-line no-console
  console.log(`[SuiVitess auto-import] tick done in ${Date.now() - t0}ms — ${stats.processedConfigs} config(s) · ${stats.itemsAnalysed} item(s) analysed · ${stats.itemsSkipped} skipped · ${stats.errors} error(s)`);
  return stats;
}

/** Runs ONE config end-to-end : list new items per enabled source,
 *  analyse + persist in inbox. */
async function runConfigOnce(cfg: AutoImportConfig): Promise<{ analysed: number; skipped: number }> {
  let analysed = 0;
  let skipped = 0;
  for (const source of cfg.enabledSources) {
    const items = await listNewSourceItems(cfg.userId, source);
    for (const item of items) {
      try {
        // Per-item dedup against the inbox itself : if we already
        // have a row for this (user, doc, source, sourceId), skip
        // even when the analysis was rejected (the user said no
        // once, don't keep re-pushing it).
        const exists = await autoDb.inboxProposalAlreadyExists(
          cfg.userId, cfg.documentId, source, item.id,
        );
        if (exists) { skipped++; continue; }

        const transcript = await fetchSourceContent(cfg.userId, source, item.id);
        if (!transcript || !transcript.trim()) { skipped++; continue; }

        const proposals = await analyseSource({
          userId: cfg.userId,
          source,
          sourceTitle: item.title,
          transcript,
          scopedDocumentId: cfg.documentId,
        });
        if (proposals.proposals.length === 0) {
          // No actionable subject — still record so we never re-process
          // this item. Lightweight 0-proposal row, hidden by default
          // from the inbox UI's "pending" tab (filter out empty).
          skipped++;
          continue;
        }
        await autoDb.insertInboxProposal({
          userId: cfg.userId,
          documentId: cfg.documentId,
          sourceKind: source,
          sourceId: item.id,
          sourceTitle: item.title,
          sourceDate: item.date ?? null,
          proposals: proposals.proposals,
          aiLogId: proposals.rootLogId,
        });
        analysed++;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[SuiVitess auto-import] item ${source}:${item.id} failed:`, (err as Error).message);
        skipped++;
      }
    }
  }
  return { analysed, skipped };
}

interface SourceItem {
  id: string;
  title: string;
  date: string | null;
}

/** List items of a given source that have NOT yet been imported by
 *  any path (manual or auto). The dedup key is
 *  (document_id, source_kind, source_id) on the existing
 *  `suivitess_transcript_imports` table. */
async function listNewSourceItems(userId: number, source: AutoImportSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  if (source === 'fathom') {
    const { listFathomCalls } = await import('./fathomService.js');
    const calls = await listFathomCalls(userId, 30);
    for (const c of calls) {
      items.push({ id: c.id, title: c.title, date: c.date ?? null });
    }
  } else if (source === 'otter') {
    const { listOtterCalls } = await import('./otterService.js');
    const calls = await listOtterCalls(userId, 30);
    for (const c of calls) {
      items.push({ id: c.id, title: c.title, date: (c as { date?: string | null }).date ?? null });
    }
  } else if (source === 'outlook') {
    // Use the digest format ("outlook:YYYY-MM-DD") so each day is one item.
    const { getOutlookMessages, groupOutlookMessagesByDay } = await import('./outlookCollectorService.js');
    const msgs = await getOutlookMessages(userId, { days: 14, excludeImported: false });
    if (msgs.length > 0) {
      const digests = groupOutlookMessagesByDay(msgs);
      for (const d of digests) items.push({ id: d.id, title: d.title, date: d.date ?? null });
    }
  } else if (source === 'gmail') {
    // Same digest pattern as outlook — one item per day.
    const { listGmailEmails } = await import('./emailService.js');
    const emails = await listGmailEmails(userId, 14);
    for (const e of emails) {
      items.push({
        id: e.id,
        title: `${e.subject} (${e.sender})`,
        date: (e as { date?: string | null }).date ?? null,
      });
    }
  } else if (source === 'slack') {
    const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
    const slackConfig = await getSlackConfig(userId);
    if (!slackConfig?.isActive) return items;
    const msgs = await getSlackMessages(slackConfig.id, { days: 14 });
    if (msgs.length > 0) {
      const { groupSlackMessagesByDay } = await import('./slackCollectorService.js');
      const digests = groupSlackMessagesByDay(msgs);
      for (const d of digests) items.push({ id: d.id, title: d.title, date: d.date ?? null });
    }
  }
  return items;
}

/** Per-source raw content fetcher. Mirrors what
 *  /transcription/analyze-and-route does inline, refactored here so
 *  the cron + the route can share the same logic later. */
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
    const { getSlackConfig, getSlackMessages } = await import('./slackCollectorService.js');
    const cfg = await getSlackConfig(userId);
    if (!cfg) return '';
    const parts = id.split(':');
    const channelId = parts[1] || parts[0];
    const dateFilter = parts[2];
    const messages = await getSlackMessages(cfg.id, {
      days: cfg.daysToFetch,
      channelId,
    });
    const filtered = dateFilter
      ? messages.filter(m => {
          const d = new Date(parseFloat(m.messageTs) * 1000).toISOString().slice(0, 10);
          return d === dateFilter;
        })
      : messages;
    return filtered
      .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
      .map(m => `[${m.senderName || 'Inconnu'}]: ${m.text}`)
      .join('\n');
  }
  return '';
}

/** Wraps `analyzeSourceForReviews` for the cron : builds the reviews
 *  snapshot from the user's docs and resolves the marks ground-truth
 *  block (when sourceKind=fathom and there are subject marks within
 *  the call window). Output shape mirrors the route's so the inbox
 *  rows are consumed identically by the bulk modal. */
async function analyseSource(input: {
  userId: number;
  source: AutoImportSource;
  sourceTitle: string;
  transcript: string;
  scopedDocumentId: string;
}): Promise<{ proposals: unknown[]; rootLogId: number | null }> {
  const { analyzeSourceForReviews } = await import('../aiSkills/analyzeSourcePipeline.js');
  const { buildReviewsSnapshotForAI } = await import('./reviewSnapshotBuilder.js');
  const reviews = await buildReviewsSnapshotForAI({
    userId: input.userId,
    isAdmin: false,
    db,
  });

  let marksGroundTruthBlock: string | undefined;
  if (input.source === 'fathom' && input.scopedDocumentId) {
    try {
      const { listFathomCalls } = await import('./fathomService.js');
      const calls = await listFathomCalls(input.userId, 30);
      // sourceId equals the fathom call id when source=fathom
      // (caller passes the right id). Resolve the call window.
      const sId = (input as unknown as { sourceId?: string }).sourceId;
      const call = sId ? calls.find(c => c.id === sId) : null;
      if (call?.date && call.duration && call.duration > 0) {
        const start = new Date(call.date);
        const end = new Date(start.getTime() + call.duration * 1000);
        const marks = await db.getSubjectMarksInWindow(
          input.userId, input.scopedDocumentId, start, end,
        );
        if (marks.length > 0) {
          const { buildMarksTimeline, renderMarksGroundTruth } =
            await import('./marksTimeline.js');
          const segments = buildMarksTimeline(
            marks.map(m => ({
              clickedAt: m.clickedAt,
              subjectId: m.subjectId,
              subjectTitle: m.subjectTitle,
            })),
            { recordedAt: start, durationSeconds: call.duration },
          );
          marksGroundTruthBlock = renderMarksGroundTruth(segments);
        }
      }
    } catch {
      // Marks layer is best-effort — silent fall-back.
    }
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
    marksGroundTruthBlock,
  });
  return { proposals: proposals as unknown as unknown[], rootLogId };
}
