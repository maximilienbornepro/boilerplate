#!/usr/bin/env npx tsx
/**
 * Bulk synthesize of EVERY subject situation in the suivitess module.
 *
 * Mirrors the per-subject "Synthétiser" button, but applied at scale :
 *   1. Snapshot every document that owns at least one non-empty subject
 *      situation BEFORE any write. This is the backup the user explicitly
 *      requested — restorable from the snapshots UI or by SQL.
 *   2. For each subject with a non-empty `situation`, call the
 *      `suivitess-synthesize-situation` skill via the shared `runSkill`
 *      plumbing and replace `subject.situation` with the AI's cleaned
 *      version. Same exact code path the HTTP endpoint uses.
 *   3. Tolerate per-subject failures : log + continue. The script never
 *      overwrites a situation with empty / invalid AI output.
 *
 * Concurrency : 3 (tunable via env `SYNTH_CONCURRENCY`). Keeps the
 * Anthropic rate within polite bounds while still finishing in a
 * reasonable wall-clock.
 *
 * Usage :
 *   APP_DATABASE_URL=postgres://… npx tsx scripts/synthesize-all-situations.ts
 *   --dry-run  : count + snapshot, but skip the AI calls. Safe preview.
 *   --user N   : restrict to user_id N (default : all users).
 *   --doc ID   : restrict to a single document. Repeatable.
 *
 * Cost & time : ~146 LLM calls × ~5-10 s/call ≈ 25 min wall-clock at
 *   concurrency 3, ~0.50–1 USD total at Sonnet 4 pricing.
 */

import pg from 'pg';
import { initDb, pool, getSubject, updateSubjectFields, createSnapshotForDocument } from '../apps/platform/servers/unified/src/modules/suivitess/dbService.js';
import { runSkill } from '../apps/platform/servers/unified/src/modules/aiSkills/runSkill.js';
import { initLogsPool } from '../apps/platform/servers/unified/src/modules/aiSkills/analysisLogsService.js';

const { Pool } = pg;
void Pool; // keep the type import referenced

const CONCURRENCY = Number(process.env.SYNTH_CONCURRENCY ?? '3');
const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}
function argValuesAll(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === flag) out.push(process.argv[i + 1]);
  }
  return out;
}

const ONLY_USER = argValue('--user');
const ONLY_DOCS = argValuesAll('--doc');

interface SubjectRow {
  subject_id: string;
  subject_title: string;
  document_id: string;
  owner_id: number | null;
  user_email: string | null;
}

async function loadSubjects(): Promise<SubjectRow[]> {
  const params: (string | number)[] = [];
  const where: string[] = [`sj.situation IS NOT NULL`, `LENGTH(TRIM(sj.situation)) > 0`];
  if (ONLY_USER) {
    params.push(parseInt(ONLY_USER, 10));
    where.push(`d.owner_id = $${params.length}`);
  }
  if (ONLY_DOCS.length > 0) {
    params.push(ONLY_DOCS.join(','));
    where.push(`d.id = ANY(string_to_array($${params.length}, ',')::text[])`);
  }
  const q = await pool.query<SubjectRow>(
    `SELECT sj.id AS subject_id,
            sj.title AS subject_title,
            s.document_id AS document_id,
            d.owner_id AS owner_id,
            u.email AS user_email
       FROM suivitess_subjects sj
       JOIN suivitess_sections s ON s.id = sj.section_id
       JOIN suivitess_documents d ON d.id = s.document_id
       LEFT JOIN users u ON u.id = d.owner_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.id, s.position, sj.position`,
    params,
  );
  return q.rows;
}

async function snapshotDocuments(docIds: Set<string>): Promise<void> {
  // Hard-fail on any snapshot error : a missing backup before a bulk
  // synth is the exact failure mode the user explicitly asked to
  // avoid. We surface the underlying error and abort the run so no
  // situation gets overwritten without a safety net.
  let count = 0;
  for (const id of docIds) {
    await createSnapshotForDocument(id, 'bulk_synth');
    count++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ snapshot ${id}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[synthesize-all] ${count}/${docIds.size} document(s) snapshotted as type='bulk_synth'`);
}

/** Same parser the route uses — strip ``` fences, parse, surface the
 *  `situation` string field. Null on any issue so the caller can skip. */
function parseSynthesizeOutput(raw: string): string | null {
  let json = raw.trim();
  if (json.startsWith('```json')) json = json.slice(7);
  if (json.startsWith('```')) json = json.slice(3);
  if (json.endsWith('```')) json = json.slice(0, -3);
  try {
    const parsed = JSON.parse(json.trim()) as { situation?: unknown };
    if (typeof parsed.situation === 'string' && parsed.situation.trim().length > 0) {
      return parsed.situation;
    }
  } catch { /* fall through */ }
  // Fallback : last-resort regex match for a brace-delimited object.
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { situation?: unknown };
      if (typeof parsed.situation === 'string' && parsed.situation.trim().length > 0) {
        return parsed.situation;
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function synthesizeOne(s: SubjectRow): Promise<{ ok: boolean; reason?: string }> {
  const existing = await getSubject(s.subject_id);
  if (!existing) return { ok: false, reason: 'subject not found' };
  const inputPayload = {
    subjectTitle: existing.title,
    currentSituation: existing.situation || '',
  };
  const inputSummary = JSON.stringify(inputPayload, null, 2);

  const userId = s.owner_id ?? 1;
  const userEmail = s.user_email;

  let runRes;
  try {
    runRes = await runSkill({
      slug: 'suivitess-synthesize-situation',
      userId,
      userEmail: userEmail ?? null,
      buildPrompt: (skill) => `${skill}\n\n---\n\n# Sujet à synthétiser\n\n${inputSummary}\n\nApplique les règles ci-dessus et réponds uniquement en JSON.`,
      inputContent: inputSummary,
      sourceKind: 'subject',
      sourceTitle: existing.title,
      documentId: null,
      maxTokens: 4096,
    });
  } catch (err) {
    return { ok: false, reason: `runSkill threw: ${(err as Error).message}` };
  }

  const newSituation = parseSynthesizeOutput(runRes.outputText);
  if (!newSituation) {
    return { ok: false, reason: `unparseable AI output (logId=${runRes.logId ?? 'none'})` };
  }

  if (DRY_RUN) {
    return { ok: true, reason: 'dry-run, no write' };
  }

  await updateSubjectFields(s.subject_id, ['situation = $1'], [newSituation]);
  return { ok: true };
}

/** Promise-pool : run `fn` on every element of `items` with at most
 *  `concurrency` in-flight at once. Resolves once all are done. */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
}

async function main() {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log('[synthesize-all] initialising DB pool…');
  await initDb();
  // Init the ai_analysis_logs pool too — otherwise every runSkill call
  // emits "Cannot read properties of undefined (reading 'query')" while
  // trying to persist its audit log. The actual LLM call succeeds, but
  // we lose the /ai-logs trace, which makes auditing the bulk run hard.
  await initLogsPool();

  const subjects = await loadSubjects();
  // eslint-disable-next-line no-console
  console.log(`[synthesize-all] ${subjects.length} subject(s) with a non-empty situation to process.`);
  if (subjects.length === 0) {
    await pool.end();
    return;
  }

  const docIds = new Set<string>(subjects.map(s => s.document_id));
  // eslint-disable-next-line no-console
  console.log(`[synthesize-all] taking snapshots of ${docIds.size} document(s) before any write…`);
  await snapshotDocuments(docIds);

  if (DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log('[synthesize-all] --dry-run : will call the AI but NOT write the result back.');
  }

  let okCount = 0;
  let failCount = 0;
  let processed = 0;
  await runWithConcurrency(subjects, CONCURRENCY, async (s) => {
    const start = Date.now();
    const res = await synthesizeOne(s);
    processed++;
    const ms = Date.now() - start;
    if (res.ok) {
      okCount++;
      // eslint-disable-next-line no-console
      console.log(`  [${processed}/${subjects.length}] ✓ ${s.subject_title.slice(0, 60)} (${ms}ms)`);
    } else {
      failCount++;
      // eslint-disable-next-line no-console
      console.warn(`  [${processed}/${subjects.length}] ✗ ${s.subject_title.slice(0, 60)} — ${res.reason} (${ms}ms)`);
    }
  });

  const wall = Math.round((Date.now() - t0) / 1000);
  // eslint-disable-next-line no-console
  console.log(
    `[synthesize-all] done in ${wall}s`,
    `\n  ok       : ${okCount}`,
    `\n  failed   : ${failCount}`,
    `\n  total    : ${subjects.length}`,
    `\n  mode     : ${DRY_RUN ? 'dry-run (no DB write)' : 'live'}`,
  );

  await pool.end();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[synthesize-all] fatal:', err);
  process.exit(1);
});
