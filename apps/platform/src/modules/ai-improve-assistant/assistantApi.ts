// Thin fetch wrappers over endpoints that already exist in /ai-skills/api.
// Zero business logic — just types + URLs — so the assistant stays readable
// and the existing pages (/ai-logs, /ai-evals, /ai-playground) remain the
// source of truth for every endpoint.

const API = '/ai-skills/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Skills ────────────────────────────────────────────────────────────

export interface Skill {
  slug: string;
  name: string;
  description: string;
  usage?: { module: string; endpoint: string; trigger: string };
  isCustomized?: boolean;
}

export interface SkillDetail extends Skill {
  content: string;
  defaultContent: string;
}

export interface SkillVersion {
  id: number;
  hash: string;
  short: string;
  content: string;
  createdAt: string;
  createdByUserId: number | null;
  isCurrent: boolean;
}

export const listSkills = () => request<Skill[]>('');
export const getSkillDetail = (slug: string) => request<SkillDetail>(`/${slug}`);
export const listSkillVersions = (slug: string) => request<SkillVersion[]>(`/${slug}/versions`);
export const saveSkillContent = (slug: string, content: string) =>
  request<unknown>(`/${slug}`, { method: 'PUT', body: JSON.stringify({ content }) });
export const resetSkillToDefault = (slug: string) =>
  request<unknown>(`/${slug}/reset`, { method: 'POST' });

// ── Logs ──────────────────────────────────────────────────────────────

export interface RecentInput {
  id: number;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  input_preview: string;
  input_length: number;
  created_at: string;
}

export interface LogDetail {
  id: number;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  input_content: string;
  full_prompt: string;
  ai_output_raw: string;
  proposals_count: number;
  duration_ms: number | null;
  cost_usd: string | null;
  model: string | null;
  created_at: string;
  error: string | null;
}

export interface ScoreRow {
  id: number;
  log_id: number;
  score_name: string;
  score_value: string;
  scorer_kind: 'heuristic' | 'llm-judge' | 'human';
  scorer_id: string | null;
  rationale: string | null;
  annotator_user_id: number | null;
  created_at: string;
}

export const listRecentInputsForSkill = (slug: string, limit = 40) =>
  request<RecentInput[]>(`/logs/recent-inputs?skill=${encodeURIComponent(slug)}&limit=${limit}`);
export const getLogDetail = (id: number) => request<LogDetail>(`/logs/${id}`);
export const listScoresForLog = (id: number) => request<ScoreRow[]>(`/logs/${id}/scores`);
export const voteLog = (id: number, value: -1 | 1, rationale?: string) =>
  request<ScoreRow>(`/logs/${id}/scores`, {
    method: 'POST',
    body: JSON.stringify({ name: 'thumbs', value, rationale: rationale || null }),
  });
/** Force a (re-)run of every heuristic + llm-judge scorer on a given log.
 *  Useful when the log predates the scoring infra or the auto-run crashed. */
export const rescoreLog = (id: number) =>
  request<ScoreRow[]>(`/logs/${id}/rescore`, { method: 'POST' });

// ── Datasets ──────────────────────────────────────────────────────────

export interface Dataset {
  id: number;
  name: string;
  skill_slug: string;
  description: string | null;
  created_at: string;
  item_count?: number;
}

export interface DatasetItem {
  id: number;
  dataset_id: number;
  source_log_id: number | null;
  input_content: string;
  expected_output: unknown;
  expected_notes: string | null;
  position: number;
  created_at: string;
}

export interface DatasetDetail {
  dataset: Dataset;
  items: DatasetItem[];
  experiments: Experiment[];
}

export const listDatasets = (skillSlug?: string) =>
  request<Dataset[]>(skillSlug ? `/datasets?skill=${encodeURIComponent(skillSlug)}` : '/datasets');
export const createDataset = (payload: { name: string; skillSlug: string; description?: string | null }) =>
  request<Dataset>('/datasets', { method: 'POST', body: JSON.stringify(payload) });
export const getDatasetDetail = (id: number) => request<DatasetDetail>(`/datasets/${id}`);
export const addItemFromLog = (datasetId: number, logId: number, expectedOutput?: unknown, notes?: string | null) =>
  request<DatasetItem>(`/datasets/${datasetId}/items`, {
    method: 'POST',
    body: JSON.stringify({ logId, expectedOutput, notes }),
  });

// ── Experiments ───────────────────────────────────────────────────────

export interface Experiment {
  id: number;
  dataset_id: number;
  name: string;
  skill_version_hash: string;
  model: string | null;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
  runs_done?: number;
  item_count?: number;
}

export interface ExperimentReport {
  experiment: Experiment;
  items: Array<{
    item_id: number;
    input_preview: string;
    log_id: number;
    output_preview: string;
    duration_ms: number | null;
    cost_usd: number | null;
    error: string | null;
    scores: Array<{ name: string; kind: string; value: number; rationale: string | null }>;
  }>;
  baseline: Experiment | null;
  baselineItems?: ExperimentReport['items'];
  summary: {
    avgByScore: Record<string, { avg: number; count: number }>;
    totalCostUsd: number;
    totalDurationMs: number;
    itemCount: number;
  };
}

export const startExperiment = (payload: { datasetId: number; name: string; skillContent?: string }) =>
  request<Experiment>('/experiments', { method: 'POST', body: JSON.stringify(payload) });
export const getExperiment = (id: number) => request<Experiment>(`/experiments/${id}/status`);
export const getExperimentReport = (id: number) => request<ExperimentReport>(`/experiments/${id}`);

// ── Playground ────────────────────────────────────────────────────────

export interface PlaygroundVariant { label: string; content: string }
export interface PlaygroundInput { label?: string; content: string }
export interface PlaygroundCell {
  variantIndex: number;
  inputIndex: number;
  variantLabel: string;
  inputLabel: string;
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
  cells: PlaygroundCell[];
}

export const runPlayground = (payload: { skillSlug: string; variants: PlaygroundVariant[]; inputs: PlaygroundInput[] }) =>
  request<PlaygroundResult>('/playground/run', { method: 'POST', body: JSON.stringify(payload) });

// ── Polling helper ────────────────────────────────────────────────────

/** Polls an experiment until it reaches a terminal status or the caller aborts. */
export async function pollExperimentUntilDone(
  id: number,
  opts: {
    onProgress?: (exp: Experiment) => void;
    signal?: AbortSignal;
    intervalMs?: number;
  } = {},
): Promise<Experiment> {
  const interval = opts.intervalMs ?? 2000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) throw new Error('Polling aborted');
    const exp = await getExperiment(id);
    opts.onProgress?.(exp);
    if (exp.status === 'done' || exp.status === 'error') return exp;
    await new Promise(r => setTimeout(r, interval));
  }
}
