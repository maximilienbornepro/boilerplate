// Canonical wrapper that every AI call-site should use (phase-1 refactor).
// It :
//   1. loads the current skill content + captures a version hash
//   2. builds the final prompt via the caller's `buildPrompt(skillContent)`
//   3. calls Claude via the shared connector
//   4. reads the usage (input/output tokens) and computes cost
//   5. writes ONE row to ai_analysis_logs with all the enriched fields
//   6. writes the usage row to ai_usage_logs (legacy, kept for compat)
//   7. returns { logId, outputText, usage } so the caller can render + link
//
// Non-goals : does NOT parse proposals — callers know their own output
// shape and supply it back to `logAnalysis` directly if needed. Instead we
// return the raw text and let each call-site parse it.

import { loadSkill } from './skillLoader.js';
import { ensureSkillVersion } from './skillVersionService.js';
import { logAnalysis } from './analysisLogsService.js';
import { computeCostUsd } from './pricing.js';
import { getAnthropicClient, logAnthropicUsage } from '../connectors/aiProvider.js';

export interface RunSkillInput {
  /** Registry slug, e.g. 'suivitess-route-source-to-review'. */
  slug: string;
  userId: number;
  userEmail?: string | null;
  /** Legacy path : builds ONE user message (skill + context concatenated).
   *  Single round, no prompt caching. Still supported for backward compat. */
  buildPrompt?: (skillContent: string) => string;
  /** Preferred path : returns only the execution context (no skill body).
   *  The skill becomes a cacheable system block on Anthropic. Saves ~90%
   *  on repeat skill tokens when the same skill is called N times within
   *  ~5 minutes (pipeline tier 3, batch evals, etc).
   *  Silently falls back to non-cached behaviour for non-Anthropic
   *  providers once runSkill is extended to them. */
  buildContext?: () => string;
  /** Raw input (e.g. transcript, email body). Stored separately from the
   *  full prompt so admins can re-use it in replay/dataset features. */
  inputContent: string;
  sourceKind: string;
  sourceTitle: string;
  documentId?: string | null;
  /** If this run originates from a replay or an experiment, point at the
   *  original log so the UI can show a lineage. */
  parentLogId?: number | null;
  /** Proposals already parsed by the caller, to be stored as JSON and
   *  counted. Pass the raw output if the caller does its own parsing. */
  proposals?: unknown;
  /** Override for the default Claude max_tokens limit. */
  maxTokens?: number;
}

export interface RunSkillResult {
  logId: number | null;
  outputText: string;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Anthropic prompt caching : tokens read from the cache (paid at ~0.1×). */
    cacheReadTokens: number;
    /** Anthropic prompt caching : tokens written to the cache on first use
     *  (paid at ~1.25×). */
    cacheCreationTokens: number;
    costUsd: number;
    durationMs: number;
    skillVersionHash: string;
  };
  error: string | null;
}

/** Run a skill against Claude with full tracing. Never throws — errors are
 *  captured on the result object and written to the log. */
export async function runSkill(input: RunSkillInput): Promise<RunSkillResult> {
  const startedAt = Date.now();

  // 1) Load skill content + version hash.
  const skillContent = await loadSkill(input.slug);
  const { hash: skillVersionHash } = await ensureSkillVersion(
    input.slug,
    skillContent,
    null, // system-run (caller's userId is captured on the log row itself)
  );

  // 2) Choose path : cacheable (buildContext) OR legacy (buildPrompt).
  const useCaching = typeof input.buildContext === 'function';
  const userContent = useCaching ? input.buildContext!() : input.buildPrompt!(skillContent);
  // Full prompt text we store in the log : skill + user-content. Keeps
  // /ai-logs replay working regardless of the path we used.
  const fullPromptForLog = useCaching
    ? `${skillContent}\n\n---\n\n${userContent}`
    : userContent;

  // 3) Call Claude. Caching is Anthropic-specific — we enable it only when
  //    useCaching is true. For other providers (future), the skill will be
  //    inlined into a single user message just like the legacy path.
  const { client, model } = await getAnthropicClient(input.userId);
  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let errorMsg: string | null = null;
  try {
    const payload: Parameters<typeof client.messages.create>[0] = useCaching
      ? {
          model,
          max_tokens: input.maxTokens ?? 4096,
          system: [
            { type: 'text', text: skillContent, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: userContent }],
        }
      : {
          model,
          max_tokens: input.maxTokens ?? 4096,
          messages: [{ role: 'user', content: userContent }],
        };
    const aiRes = await client.messages.create(payload);
    outputText = aiRes.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');
    // Anthropic returns cache_* only when cache_control was used. The SDK
    // types mark them optional so we read defensively.
    const usage = aiRes.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    } | undefined;
    inputTokens = usage?.input_tokens ?? 0;
    outputTokens = usage?.output_tokens ?? 0;
    cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;

    // Legacy usage table (untouched by phase 1) for backwards-compat
    // dashboards that still read from ai_usage_logs.
    logAnthropicUsage(input.userId, model, aiRes.usage, `aiSkills:${input.slug}`);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'Erreur IA';
  }

  const durationMs = Date.now() - startedAt;
  // Cost accounting with cache pricing : cache_creation is billed 1.25×
  // standard input, cache_read is billed 0.1× (per Anthropic pricing page).
  // The monolithic `computeCostUsd` can't model that breakdown yet, so we
  // adjust here by approximating an equivalent non-cached token count.
  // `inputTokens` already excludes cache_read/creation on Anthropic's side.
  const equivalentInputTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  const costUsd = computeCostUsd(model, equivalentInputTokens, outputTokens);
  // Surface cache stats in server logs so the operator can verify the hit
  // rate on a warm run.
  if (useCaching && (cacheReadTokens > 0 || cacheCreationTokens > 0)) {
    // eslint-disable-next-line no-console
    console.log(`[runSkill:${input.slug}] cache hit_tokens=${cacheReadTokens} create_tokens=${cacheCreationTokens} fresh_input=${inputTokens}`);
  }

  // 4) Single enriched log row.
  const logId = await logAnalysis({
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    skillSlug: input.slug,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    documentId: input.documentId ?? null,
    inputContent: input.inputContent,
    fullPrompt: fullPromptForLog,
    aiOutputRaw: outputText,
    proposals: input.proposals ?? null,
    durationMs,
    error: errorMsg,
    skillVersionHash,
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens,
    costUsd: costUsd > 0 ? costUsd : null,
    parentLogId: input.parentLogId ?? null,
  });

  // Fire-and-forget : run auto scorers (heuristics) on the newly-created log.
  // We skip this when logging failed or when the call errored out. The judge
  // scorers are still executed via `POST /logs/:id/rescore` if desired.
  if (logId != null && !errorMsg) {
    setImmediate(() => {
      import('./scoring/scoringService.js')
        .then(m => m.runAutoScorersForLog(logId))
        .catch(err => console.error('[AiSkills] auto-score fire-and-forget failed:', err));
    });
  }

  return {
    logId,
    outputText,
    error: errorMsg,
    usage: {
      provider: 'anthropic',
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      durationMs,
      skillVersionHash,
    },
  };
}
