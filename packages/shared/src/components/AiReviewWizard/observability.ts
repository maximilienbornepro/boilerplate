import type { ReviewableDecision } from './types';

/* ═══════════════════════════════════════════════════════════════════
   Observability helpers
   ───────────────────────────────────────────────────────────────────
   Thin wrappers around the platform's `/ai-skills/api/logs/:id/scores`
   endpoint so consumers don't re-implement the same fetch boilerplate
   every time they wire an AiReviewWizard. Everything here is
   fire-and-forget: network errors are swallowed because a failed
   thumbs-down shouldn't block the user's review flow.
   ═══════════════════════════════════════════════════════════════════ */

export interface FlagOptions {
  /** The rationale saved on the score row. Shown on /ai-logs and
   *  /ai-routing as context for why the user disagreed. */
  rationale: string;
  /** Override the scoring endpoint base. Defaults to the platform's
   *  mount (`/ai-skills/api`). Exposed for tests + non-platform hosts. */
  apiBase?: string;
}

/** Record a human thumbs-down score on an analysis log. Surfaces the
 *  log as "⚠ flaggé" on /ai-logs (orange row, filter pill), and
 *  increments the `disagree_count` returned by `/logs/list`.
 *
 *  Safe to call with a null/undefined `logId` — the helper no-ops so
 *  callers don't have to check themselves. */
export async function flagDisagreement(
  logId: number | null | undefined,
  opts: FlagOptions,
): Promise<void> {
  if (logId == null) return;
  const apiBase = opts.apiBase ?? '/ai-skills/api';
  try {
    await fetch(`${apiBase}/logs/${logId}/scores`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'human.thumbs',
        value: -1,
        rationale: opts.rationale,
      }),
    });
  } catch {
    /* Fire-and-forget — a failed score should never block the UI. */
  }
}

/** Build a ready-to-plug `onDisagree` handler that POSTs a thumbs-down
 *  score when the user disagrees with a decision. The rationale is
 *  derived from the decision's title by default; override via
 *  `buildRationale` for richer context.
 *
 *  @example
 *  <AiReviewWizard
 *    decisions={proposals}
 *    onDisagree={createDisagreeHandler({
 *      buildRationale: d => `Désaccord sur « ${d.title} » — ${d.payload.kind}`,
 *    })}
 *    ...
 *  />
 *
 *  The wizard de-duplicates tile clicks internally, but the handler
 *  itself is idempotent: spamming it just writes multiple score rows
 *  (which is actually what you want — one per click, auditable).
 *  If you need stricter dedup (one score per (log, subject) pair),
 *  keep a local Set in the consumer. */
export function createDisagreeHandler<T>(
  options: {
    buildRationale?: (decision: ReviewableDecision<T>) => string;
    apiBase?: string;
  } = {},
): (decision: ReviewableDecision<T>) => void {
  const buildRationale = options.buildRationale
    ?? ((d: ReviewableDecision<T>) => `Désaccord sur « ${d.title} »`);
  return (decision: ReviewableDecision<T>) => {
    void flagDisagreement(decision.logId, {
      rationale: buildRationale(decision),
      apiBase: options.apiBase,
    });
  };
}
