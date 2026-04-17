// Playground : run N prompt variants × M inputs in parallel (row-by-row, to
// avoid blowing up rate limits). Each cell reuses `runSkill` so everything
// ends up as an ai_analysis_logs row — scorers auto-fire, logs appear in the
// /ai-logs history, and the admin can promote the whole run to an experiment.
//
// Concurrency : naive pool of 4 parallel in-flight calls (hardcoded).

import { runSkill } from '../runSkill.js';
import { runAutoScorersForLog } from '../scoring/scoringService.js';
import { listScoresForLog } from '../scoring/scoringService.js';

export interface PlaygroundVariant {
  /** Short label shown as column header in the UI. */
  label: string;
  /** Full skill content (may differ from the current DB version). */
  content: string;
}

export interface PlaygroundInput {
  label?: string;
  content: string;
}

export interface PlaygroundCell {
  variantLabel: string;
  inputLabel: string;
  inputIndex: number;
  variantIndex: number;
  logId: number | null;
  output: string;
  error: string | null;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  scores: Array<{ name: string; kind: string; value: number; rationale: string | null }>;
}

export interface PlaygroundResult {
  skillSlug: string;
  variants: Array<{ label: string; shortHash: string }>;
  inputs: Array<{ label: string }>;
  cells: PlaygroundCell[];   // length = variants.length * inputs.length
}

async function runOneCell(
  skillSlug: string,
  variant: PlaygroundVariant,
  variantIndex: number,
  input: PlaygroundInput,
  inputIndex: number,
  userId: number,
  userEmail: string | null,
): Promise<PlaygroundCell> {
  const runRes = await runSkill({
    slug: skillSlug,
    userId,
    userEmail,
    buildPrompt: (skill) => {
      // Override : we pass the playground variant content instead of the
      // DB-stored skill — but runSkill always loads the current skill. To
      // actually use the variant, we ignore `skill` and splice the variant.
      return `${variant.content}\n\n---\n\n# Input\n${input.content}\n\nApplique les règles et réponds uniquement en JSON.`;
    },
    inputContent: input.content,
    sourceKind: 'playground',
    sourceTitle: `[playground] ${variant.label} × ${input.label ?? `input #${inputIndex}`}`,
    documentId: null,
  });

  // Explicitly run scorers AWAIT so we can include them in the response.
  if (runRes.logId != null) await runAutoScorersForLog(runRes.logId);
  const scoreRows = runRes.logId != null ? await listScoresForLog(runRes.logId) : [];

  return {
    variantLabel: variant.label,
    inputLabel: input.label ?? `input #${inputIndex}`,
    variantIndex,
    inputIndex,
    logId: runRes.logId,
    output: runRes.outputText,
    error: runRes.error,
    durationMs: runRes.usage.durationMs,
    costUsd: runRes.usage.costUsd,
    inputTokens: runRes.usage.inputTokens,
    outputTokens: runRes.usage.outputTokens,
    scores: scoreRows.map(s => ({
      name: s.score_name,
      kind: s.scorer_kind,
      value: parseFloat(s.score_value),
      rationale: s.rationale,
    })),
  };
}

const MAX_CONCURRENCY = 4;

export async function runPlayground(opts: {
  skillSlug: string;
  variants: PlaygroundVariant[];
  inputs: PlaygroundInput[];
  userId: number;
  userEmail?: string | null;
}): Promise<PlaygroundResult> {
  const { hashContent, ensureSkillVersion } = await import('../skillVersionService.js');

  // Hash-register every variant so logs can later be analyzed by skill_version_hash.
  for (const v of opts.variants) {
    await ensureSkillVersion(opts.skillSlug, v.content, opts.userId);
  }

  // Build flat list of (variantIdx, inputIdx) pairs.
  const pairs: Array<{ vi: number; ii: number }> = [];
  for (let vi = 0; vi < opts.variants.length; vi++) {
    for (let ii = 0; ii < opts.inputs.length; ii++) {
      pairs.push({ vi, ii });
    }
  }

  // Naive concurrency-limited Promise.all.
  const cells: PlaygroundCell[] = [];
  let i = 0;
  const inflight: Promise<void>[] = [];
  const runNext = async (): Promise<void> => {
    while (i < pairs.length) {
      const idx = i++;
      const { vi, ii } = pairs[idx];
      const cell = await runOneCell(
        opts.skillSlug,
        opts.variants[vi], vi,
        opts.inputs[ii], ii,
        opts.userId, opts.userEmail ?? null,
      );
      cells[idx] = cell;
    }
  };
  for (let k = 0; k < Math.min(MAX_CONCURRENCY, pairs.length); k++) {
    inflight.push(runNext());
  }
  await Promise.all(inflight);

  return {
    skillSlug: opts.skillSlug,
    variants: opts.variants.map(v => ({ label: v.label, shortHash: hashContent(v.content).slice(0, 7) })),
    inputs: opts.inputs.map((inp, i) => ({ label: inp.label ?? `input #${i}` })),
    cells,
  };
}
