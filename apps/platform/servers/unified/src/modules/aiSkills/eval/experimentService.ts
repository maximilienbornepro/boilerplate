// Experiments = "run skill version X on a dataset, collect results + scores".
// Each item of the dataset gets one ai_analysis_logs row (via runSkill) and
// one ai_eval_experiment_runs row linking them. Auto-scorers fire on every
// log so the comparison with a baseline experiment is scored uniformly.

import { getEvalPool, listItems, getDataset } from './datasetService.js';
import { runSkill } from '../runSkill.js';
import { ensureSkillVersion } from '../skillVersionService.js';
import { runAutoScorersForLog } from '../scoring/scoringService.js';
import type { Pool } from 'pg';

export interface ExperimentRow {
  id: number;
  dataset_id: number;
  name: string;
  skill_version_hash: string;
  model: string | null;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_by: number | null;
  created_at: string;
  // Computed in SQL via joins — how many items finished vs how many exist.
  runs_done?: number;
  item_count?: number;
}

export interface ExperimentRunRow {
  id: number;
  experiment_id: number;
  item_id: number;
  log_id: number;
  created_at: string;
}

function pool(): Pool { return getEvalPool(); }

// ── Create + list ──

export async function createExperiment(opts: {
  datasetId: number;
  name: string;
  skillVersionHash: string;
  model: string | null;
  createdBy: number | null;
}): Promise<ExperimentRow> {
  const { rows } = await pool().query<ExperimentRow>(
    `INSERT INTO ai_eval_experiments
       (dataset_id, name, skill_version_hash, model, status, created_by)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [opts.datasetId, opts.name.slice(0, 200), opts.skillVersionHash, opts.model, opts.createdBy],
  );
  return rows[0];
}

// Shared SELECT expression : joins run count (how many items of this
// experiment have finished) and dataset's total item count.
const EXPERIMENT_WITH_PROGRESS_SQL = `
  SELECT e.*,
         COALESCE(r.n, 0)::int AS runs_done,
         COALESCE(i.n, 0)::int AS item_count
    FROM ai_eval_experiments e
    LEFT JOIN (
      SELECT experiment_id, COUNT(*)::int AS n
        FROM ai_eval_experiment_runs
       GROUP BY experiment_id
    ) r ON r.experiment_id = e.id
    LEFT JOIN (
      SELECT dataset_id, COUNT(*)::int AS n
        FROM ai_eval_dataset_items
       GROUP BY dataset_id
    ) i ON i.dataset_id = e.dataset_id
`;

export async function listExperimentsForDataset(datasetId: number): Promise<ExperimentRow[]> {
  const { rows } = await pool().query<ExperimentRow>(
    `${EXPERIMENT_WITH_PROGRESS_SQL}
      WHERE e.dataset_id = $1
      ORDER BY e.created_at DESC`,
    [datasetId],
  );
  return rows;
}

export async function getExperiment(id: number): Promise<ExperimentRow | null> {
  const { rows } = await pool().query<ExperimentRow>(
    `${EXPERIMENT_WITH_PROGRESS_SQL} WHERE e.id = $1`, [id],
  );
  return rows[0] ?? null;
}

export async function setExperimentStatus(
  id: number,
  status: ExperimentRow['status'],
  error?: string | null,
): Promise<void> {
  const stamp = status === 'running'
    ? 'started_at = NOW()'
    : status === 'done' || status === 'error'
      ? 'finished_at = NOW()'
      : 'started_at = started_at';
  await pool().query(
    `UPDATE ai_eval_experiments
        SET status = $2, error = $3, ${stamp}
      WHERE id = $1`,
    [id, status, error ?? null],
  );
}

/** Mark any experiment left in `running` or `pending` as `error` at boot.
 *  These are zombies from a previous process that died mid-flight (dev tsx
 *  reload, container OOM, deploy…). Called once in initAiSkills. */
export async function recoverOrphanedExperiments(): Promise<number> {
  const { rowCount } = await pool().query(
    `UPDATE ai_eval_experiments
        SET status = 'error',
            error = COALESCE(error, 'Interrompu par redémarrage du serveur'),
            finished_at = NOW()
      WHERE status IN ('pending','running')`,
  );
  return rowCount ?? 0;
}

export async function listRuns(experimentId: number): Promise<ExperimentRunRow[]> {
  const { rows } = await pool().query<ExperimentRunRow>(
    `SELECT * FROM ai_eval_experiment_runs
      WHERE experiment_id = $1
      ORDER BY item_id ASC`,
    [experimentId],
  );
  return rows;
}

// ── Runner ──

/** Runs the experiment synchronously item-by-item. Callers should kick this
 *  off via `setImmediate` so the HTTP response returns immediately. Writes
 *  status = 'running' then 'done' (or 'error'). */
export async function executeExperiment(opts: {
  experimentId: number;
  datasetId: number;
  skillSlug: string;
  skillContent: string;         // the content to use for this run (already hashed into skill_version_hash)
  userId: number;
  userEmail?: string | null;
  buildPrompt: (skillContent: string, inputContent: string) => string;
}): Promise<void> {
  const items = await listItems(opts.datasetId);
  if (items.length === 0) {
    await setExperimentStatus(opts.experimentId, 'done');
    return;
  }

  await setExperimentStatus(opts.experimentId, 'running');
  console.log(`[AiSkills] experiment #${opts.experimentId} running on ${items.length} item(s)`);
  try {
    let idx = 0;
    for (const item of items) {
      idx++;
      const itemStart = Date.now();
      const runRes = await runSkill({
        slug: opts.skillSlug,
        userId: opts.userId,
        userEmail: opts.userEmail ?? null,
        buildPrompt: () => opts.buildPrompt(opts.skillContent, item.input_content),
        inputContent: item.input_content,
        sourceKind: 'experiment',
        sourceTitle: `[exp#${opts.experimentId}] item#${item.id}`,
        documentId: null,
      });
      if (runRes.logId != null) {
        await pool().query(
          `INSERT INTO ai_eval_experiment_runs (experiment_id, item_id, log_id)
           VALUES ($1, $2, $3)`,
          [opts.experimentId, item.id, runRes.logId],
        );
        // Scorers run fire-and-forget inside runSkill already ; we await here
        // so the report shows them once the experiment finishes.
        try { await runAutoScorersForLog(runRes.logId); }
        catch (err) { console.error(`[AiSkills] exp#${opts.experimentId} scorers failed:`, err); }
      }
      console.log(
        `[AiSkills] exp#${opts.experimentId} item ${idx}/${items.length} done (${Date.now() - itemStart}ms, logId=${runRes.logId}, error=${runRes.error ?? 'none'})`,
      );
    }
    await setExperimentStatus(opts.experimentId, 'done');
    console.log(`[AiSkills] experiment #${opts.experimentId} DONE`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error(`[AiSkills] experiment #${opts.experimentId} FAILED:`, err);
    await setExperimentStatus(opts.experimentId, 'error', msg);
  }
}

// ── Report aggregation ──

export interface ExperimentItemReport {
  item_id: number;
  input_preview: string;
  log_id: number;
  output_preview: string;
  duration_ms: number | null;
  cost_usd: number | null;
  error: string | null;
  scores: Array<{ name: string; kind: string; value: number; rationale: string | null }>;
}

export interface ExperimentReport {
  experiment: ExperimentRow;
  items: ExperimentItemReport[];
  baseline?: ExperimentRow | null;
  baselineItems?: ExperimentItemReport[];
  summary: {
    avgByScore: Record<string, { avg: number; count: number }>;
    totalCostUsd: number;
    totalDurationMs: number;
    itemCount: number;
  };
}

export async function findBaselineExperiment(
  datasetId: number,
  excludeId: number,
): Promise<ExperimentRow | null> {
  // Heuristic : baseline = the latest `done` experiment for the same dataset,
  // excluding the current one.
  const { rows } = await pool().query<ExperimentRow>(
    `SELECT * FROM ai_eval_experiments
      WHERE dataset_id = $1 AND id <> $2 AND status = 'done'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [datasetId, excludeId],
  );
  return rows[0] ?? null;
}

async function buildItemReports(experimentId: number): Promise<ExperimentItemReport[]> {
  const { rows } = await pool().query<{
    item_id: number; input_content: string; log_id: number;
    ai_output_raw: string; duration_ms: number | null; cost_usd: string | null; error: string | null;
  }>(
    `SELECT r.item_id, i.input_content, r.log_id,
            l.ai_output_raw, l.duration_ms, l.cost_usd, l.error
       FROM ai_eval_experiment_runs r
       JOIN ai_eval_dataset_items   i ON i.id = r.item_id
       JOIN ai_analysis_logs        l ON l.id = r.log_id
      WHERE r.experiment_id = $1
      ORDER BY r.item_id ASC`,
    [experimentId],
  );

  const reports: ExperimentItemReport[] = [];
  for (const r of rows) {
    const { rows: scoreRows } = await pool().query<{ score_name: string; scorer_kind: string; score_value: string; rationale: string | null }>(
      `SELECT score_name, scorer_kind, score_value, rationale
         FROM ai_analysis_scores
        WHERE log_id = $1`,
      [r.log_id],
    );
    reports.push({
      item_id: r.item_id,
      input_preview: r.input_content.slice(0, 300),
      log_id: r.log_id,
      output_preview: (r.ai_output_raw ?? '').slice(0, 300),
      duration_ms: r.duration_ms,
      cost_usd: r.cost_usd ? parseFloat(r.cost_usd) : null,
      error: r.error,
      scores: scoreRows.map(s => ({
        name: s.score_name,
        kind: s.scorer_kind,
        value: parseFloat(s.score_value),
        rationale: s.rationale,
      })),
    });
  }
  return reports;
}

export async function getExperimentReport(experimentId: number): Promise<ExperimentReport | null> {
  const experiment = await getExperiment(experimentId);
  if (!experiment) return null;

  const items = await buildItemReports(experimentId);

  const baseline = await findBaselineExperiment(experiment.dataset_id, experimentId);
  const baselineItems = baseline ? await buildItemReports(baseline.id) : undefined;

  // Aggregate averages.
  const avgByScore: Record<string, { avg: number; count: number; sum: number }> = {};
  let totalCost = 0;
  let totalDuration = 0;
  for (const it of items) {
    if (it.cost_usd) totalCost += it.cost_usd;
    if (it.duration_ms) totalDuration += it.duration_ms;
    for (const s of it.scores) {
      const key = `${s.kind}:${s.name}`;
      const entry = avgByScore[key] ?? { avg: 0, count: 0, sum: 0 };
      entry.sum += s.value;
      entry.count += 1;
      entry.avg = entry.sum / entry.count;
      avgByScore[key] = entry;
    }
  }
  // Strip internal `sum` before returning.
  const cleaned: Record<string, { avg: number; count: number }> = {};
  for (const [k, v] of Object.entries(avgByScore)) cleaned[k] = { avg: v.avg, count: v.count };

  return {
    experiment,
    items,
    baseline,
    baselineItems,
    summary: {
      avgByScore: cleaned,
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
      itemCount: items.length,
    },
  };
}

/** Entry point used by `POST /experiments` — assumes the skill content has
 *  been `ensureSkillVersion`ed upstream. */
export async function startExperiment(opts: {
  datasetId: number;
  name: string;
  skillContent: string;
  userId: number;
  userEmail?: string | null;
  buildPrompt: (skillContent: string, inputContent: string) => string;
}): Promise<ExperimentRow> {
  const dataset = await getDataset(opts.datasetId);
  if (!dataset) throw new Error('Dataset introuvable');

  const { hash } = await ensureSkillVersion(dataset.skill_slug, opts.skillContent, opts.userId);
  const experiment = await createExperiment({
    datasetId: opts.datasetId,
    name: opts.name,
    skillVersionHash: hash,
    model: null, // filled in by runSkill logs
    createdBy: opts.userId,
  });

  // Kick off async, don't block the HTTP response.
  setImmediate(() => {
    executeExperiment({
      experimentId: experiment.id,
      datasetId: opts.datasetId,
      skillSlug: dataset.skill_slug,
      skillContent: opts.skillContent,
      userId: opts.userId,
      userEmail: opts.userEmail,
      buildPrompt: opts.buildPrompt,
    }).catch(err => console.error('[AiSkills] experiment execution crashed:', err));
  });

  return experiment;
}
