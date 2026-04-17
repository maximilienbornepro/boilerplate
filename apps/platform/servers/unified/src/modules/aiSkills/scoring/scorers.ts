// Scorers evaluate an ai_analysis_logs row and return a score in [0..1].
// Heuristic scorers are pure functions (no network). LLM-judge scorers call
// Claude with a template prompt. Human scores aren't scorers — they're just
// recorded via `recordHumanScore`.
//
// Scorers are registered at runtime via `registerScorer`. The scoring service
// iterates the registry and writes each result to `ai_analysis_scores`.

import type { AnalysisLogRow } from '../analysisLogsService.js';

export interface ScoreResult {
  value: number;     // 0..1 (clamped), or -1..1 for thumbs
  rationale?: string;
}

export interface Scorer {
  /** Stable id, e.g. 'heuristic:json_valid/v1'. Used as the DB scorer_id. */
  id: string;
  /** Display name, e.g. 'json_valid'. Stored in score_name. */
  name: string;
  kind: 'heuristic' | 'llm-judge';
  /** Return false to skip this scorer for a given log. */
  appliesTo(log: AnalysisLogRow): boolean;
  score(log: AnalysisLogRow): Promise<ScoreResult>;
}

// ── Registry ───────────────────────────────────────────────────────────

const registry: Scorer[] = [];

export function registerScorer(scorer: Scorer): void {
  if (registry.some(s => s.id === scorer.id)) return;
  registry.push(scorer);
}

export function getRegisteredScorers(): Scorer[] {
  return [...registry];
}

// ── Heuristics ──────────────────────────────────────────────────────────

/** Returns 1 if the AI output parses as JSON, 0 otherwise. Ignores surrounding
 *  text by looking for the first array or object. */
export const jsonValidScorer: Scorer = {
  id: 'heuristic:json_valid/v1',
  name: 'json_valid',
  kind: 'heuristic',
  appliesTo: (log) => !!log.ai_output_raw && log.ai_output_raw.length > 0,
  async score(log) {
    const text = log.ai_output_raw;
    const arr = text.match(/\[[\s\S]*\]/);
    const obj = text.match(/\{[\s\S]*\}/);
    const candidates = [arr?.[0], obj?.[0]].filter(Boolean) as string[];
    for (const c of candidates) {
      try { JSON.parse(c); return { value: 1, rationale: 'Output parseable as JSON' }; }
      catch { /* try next */ }
    }
    return { value: 0, rationale: 'No parseable JSON found in output' };
  },
};

/** Penalises empty outputs and absurdly long responses. Sweet spot 1..15 proposals. */
export const proposalCountSaneScorer: Scorer = {
  id: 'heuristic:proposal_count_sane/v1',
  name: 'proposal_count_sane',
  kind: 'heuristic',
  appliesTo: () => true,
  async score(log) {
    const n = log.proposals_count;
    if (n === 0) return { value: 0, rationale: 'No proposal emitted' };
    if (n > 15) return { value: 0.3, rationale: `${n} proposals — likely over-generating` };
    if (n >= 1 && n <= 10) return { value: 1, rationale: `${n} proposals (healthy range)` };
    return { value: 0.7, rationale: `${n} proposals (borderline)` };
  },
};

/** Maps latency to a quality score. 0 ms = 1, 30+ s = 0. */
export const latencyScorer: Scorer = {
  id: 'heuristic:latency/v1',
  name: 'latency',
  kind: 'heuristic',
  appliesTo: (log) => typeof log.duration_ms === 'number',
  async score(log) {
    const ms = log.duration_ms ?? 0;
    const clamped = Math.max(0, Math.min(30_000, ms));
    const value = 1 - clamped / 30_000;
    return { value, rationale: `${ms} ms` };
  },
};

/** 1 if no error logged, 0 otherwise. */
export const noErrorScorer: Scorer = {
  id: 'heuristic:no_error/v1',
  name: 'no_error',
  kind: 'heuristic',
  appliesTo: () => true,
  async score(log) {
    return log.error
      ? { value: 0, rationale: `Error: ${log.error.slice(0, 120)}` }
      : { value: 1 };
  },
};

// Register defaults once at module load.
registerScorer(jsonValidScorer);
registerScorer(proposalCountSaneScorer);
registerScorer(latencyScorer);
registerScorer(noErrorScorer);

// ── LLM-as-judge template ────────────────────────────────────────────────

export interface LlmJudgeConfig {
  /** Slug of the judge skill in the registry (e.g. 'llm-judge-faithfulness'). */
  skillSlug: string;
  /** Short id for the DB (e.g. 'llm-judge:faithfulness/v1'). */
  id: string;
  /** Display name (e.g. 'faithfulness'). */
  name: string;
  /** Restrict to logs matching this skill, or any by default. */
  appliesToSkills?: string[];
}

/** Build an LLM-judge scorer from a configured judge skill. The judge prompt
 *  receives the source input and the AI output and must return
 *  `{ "score": 0..1, "rationale": "..." }`. */
export function buildLlmJudge(cfg: LlmJudgeConfig): Scorer {
  return {
    id: cfg.id,
    name: cfg.name,
    kind: 'llm-judge',
    appliesTo: (log) => {
      if (log.error) return false; // no point judging a failed call
      if (!cfg.appliesToSkills || cfg.appliesToSkills.length === 0) return true;
      return cfg.appliesToSkills.includes(log.skill_slug);
    },
    async score(log) {
      const { loadSkill } = await import('../skillLoader.js');
      const { getAnthropicClient } = await import('../../connectors/aiProvider.js');
      const skill = await loadSkill(cfg.skillSlug);
      const { client, model } = await getAnthropicClient(log.user_id ?? 0);

      const prompt = `${skill}

---

# Juge : évaluer cette analyse IA

## Input brut (source)
${(log.input_content ?? '').slice(0, 5000)}

## Output du modèle à évaluer
${(log.ai_output_raw ?? '').slice(0, 5000)}

Réponds UNIQUEMENT avec un JSON { "score": 0..1, "rationale": "..." }.`;

      const res = await client.messages.create({
        model,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = res.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { value: 0.5, rationale: 'Judge produced no JSON' };
      try {
        const parsed = JSON.parse(match[0]) as { score?: number; rationale?: string };
        const value = Math.max(0, Math.min(1, Number(parsed.score ?? 0.5)));
        return { value, rationale: parsed.rationale?.slice(0, 500) };
      } catch {
        return { value: 0.5, rationale: 'Judge JSON unparseable' };
      }
    },
  };
}
