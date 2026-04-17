// AI provider pricing (USD per 1M tokens). Used to compute `cost_usd` for
// every ai_analysis_logs row. Prices are static — keep this list synced with
// the latest provider cards. Missing models fall back to 0 (cost unknown).
//
// Sources :
//  - Anthropic: https://www.anthropic.com/pricing
//  - OpenAI: https://platform.openai.com/docs/pricing
//  - Mistral: https://mistral.ai/news/la-plateforme/
//  - Scaleway: https://www.scaleway.com/en/ai/generative-apis/

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  in: number;
  /** USD per 1,000,000 output tokens. */
  out: number;
}

export const PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  // ── Anthropic ──
  'claude-sonnet-4-6':         { in: 3.0,  out: 15.0 },
  'claude-3-5-sonnet-latest':  { in: 3.0,  out: 15.0 },
  'claude-3-5-haiku-latest':   { in: 0.8,  out: 4.0 },
  'claude-3-opus-latest':      { in: 15.0, out: 75.0 },
  'claude-opus-4':             { in: 15.0, out: 75.0 },

  // ── OpenAI ──
  'gpt-4o':         { in: 2.5,  out: 10.0 },
  'gpt-4o-mini':    { in: 0.15, out: 0.6 },
  'o1':             { in: 15.0, out: 60.0 },
  'o1-mini':        { in: 3.0,  out: 12.0 },

  // ── Mistral ──
  'mistral-large-latest': { in: 2.0, out: 6.0 },
  'mistral-small-latest': { in: 0.2, out: 0.6 },

  // ── Scaleway ──
  'qwen3-32b':      { in: 0.4, out: 1.5 },
  'llama-3-70b':    { in: 0.8, out: 0.8 },
};

/** Compute the cost in USD for a given model + token usage. Returns 0 for
 *  unknown models rather than throwing — keeps logging non-fatal. */
export function computeCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  if (!model) return 0;
  const p = PRICING_USD_PER_1M[model];
  if (!p) return 0;
  const inTk = inputTokens ?? 0;
  const outTk = outputTokens ?? 0;
  return (inTk * p.in + outTk * p.out) / 1_000_000;
}

/** Helper for the UI — formats a cost with 4–6 decimals so small values
 *  ($0.000123) stay readable. */
export function formatCostUsd(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '—';
  if (cost === 0) return '$0';
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}
