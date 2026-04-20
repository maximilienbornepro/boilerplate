// AI-powered delivery board sanity check.
// Compares live Jira state (status/estimation/version) with current board
// positions and returns a column-by-column plan. The AI explains, for each
// column, which kind of tickets it places there and why — based on status,
// content, estimation, and fix version.
//
// Never deletes a task, never changes a task's duration, only repositions.

import { getAnthropicClient, logAnthropicUsage } from '../connectors/aiProvider.js';
import { loadSkill as loadAiSkill } from '../aiSkills/skillLoader.js';
import { logAnalysis } from '../aiSkills/analysisLogsService.js';
import { ensureSkillVersion } from '../aiSkills/skillVersionService.js';
import { computeCostUsd } from '../aiSkills/pricing.js';

/**
 * Slug of the editable skill that holds the rules injected into the Claude
 * prompt. See `aiSkills/registry.ts` — the admin UI can override the content
 * in the DB ; the shipped default lives in `skill-reorganize-board.md`.
 */
const SKILL_SLUG = 'delivery-reorganize-board';

async function loadSkill(): Promise<string> {
  return loadAiSkill(SKILL_SLUG);
}

// ============ Public types ============

export type VersionCategory = 'next' | 'later' | 'past' | 'none';

/**
 * Source of an external ticket on the board. 'manual' is never analyzed ;
 * everything else (jira, clickup, linear, asana…) is treated as an external
 * ticket and goes through the sanity check.
 */
export type TaskSource = 'manual' | 'jira' | 'clickup' | 'linear' | 'asana' | 'trello' | string;

export interface TaskSnapshot {
  id: string;
  title: string;
  /** External reference (e.g. "DEV-123" for Jira, "CU-12ab34" for ClickUp). null for free-form titles. */
  externalKey: string | null;
  /** Name of the origin tool. "jira", "clickup", … */
  source: string;
  boardStatus: string;
  /** Fresh status from the external tool when available. */
  externalStatus: string | null;
  storyPoints: number | null;
  estimatedDays: number | null;
  hasEstimation: boolean;
  hasDescription: boolean;
  hasAssignee: boolean;
  /** "Fix version" / "Release" / "Cycle" — whatever the external tool calls an upcoming release bucket. */
  releaseTag: string | null;
  versionCategory: VersionCategory;
  position: { startCol: number; endCol: number; row: number };
}

export interface VersionInfo {
  name: string;
  releaseDate: string | null;
  category: VersionCategory;
}

export interface MissingTicket {
  /** External reference ("DEV-123", "CU-…"). */
  externalKey: string;
  /** Which tool provided this ticket ("jira", "clickup"…). */
  source: string;
  summary: string;
  status: string;
  storyPoints: number | null;
  estimatedDays: number | null;
  hasEstimation: boolean;
  hasDescription: boolean;
  assignee: string | null;
  releaseTag: string | null;
  versionCategory: VersionCategory;
  /** Name of the current iteration / sprint / cycle / list on the source side. */
  iterationName: string | null;
}

export interface BoardSnapshot {
  boardId: string;
  boardName: string;
  totalCols: number;
  todayCol: number;
  tasks: TaskSnapshot[];
  versions: VersionInfo[];
  missingFromBoard: MissingTicket[];
}

export interface AnalyzedTask {
  taskId: string;
  taskTitle: string;
  externalKey: string | null;
  source: string;
  status: string;
  version: string | null;
  versionCategory: VersionCategory;
  hasEstimation: boolean;
  hasDescription: boolean;
  current: { startCol: number; endCol: number; row: number };
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
}

export interface ProposedAddition {
  externalKey: string;
  source: string;
  summary: string;
  status: string;
  version: string | null;
  versionCategory: VersionCategory;
  hasEstimation: boolean;
  hasDescription: boolean;
  storyPoints: number | null;
  estimatedDays: number | null;
  assignee: string | null;
  iterationName: string | null;
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
}

export interface ColumnPlan {
  col: number;
  label: string;
  strategy: string; // explanation of what kind of tickets go in this column
  tasks: AnalyzedTask[];
  additions: ProposedAddition[];
}

export interface BoardAnalysis {
  totalJiraTasks: number;
  byStatus: Record<string, number>;
  missingEstimation: number;
  missingDescription: number;
  missingFromBoard: number;
  versions: VersionInfo[];
}

export interface SanityCheckResult {
  summary: string;
  analysis: BoardAnalysis;
  columns: ColumnPlan[];
}

// ============ Helpers ============

/**
 * Parse an external ticket reference from a task title formatted as
 * "[REF-123] Summary". Works for Jira (DEV-123), ClickUp (CU-abc123 when
 * prefixed that way), Linear (ENG-42), etc. — any uppercase+digit prefix.
 * Returns null if the title does not follow the pattern.
 */
export function parseExternalKey(title: string): string | null {
  // Bracketed format: [KEY-123]
  const bracketed = title.match(/^\[([A-Z][A-Z0-9_]+-[A-Za-z0-9]+)\]/);
  if (bracketed) return bracketed[1];
  // Bare format: KEY-123 at the start (delivery-process legacy)
  const bare = title.match(/^([A-Z][A-Z0-9_]+-\d+)\b/);
  return bare ? bare[1] : null;
}

/** Deprecated alias kept for backwards compatibility — use parseExternalKey. */
export const parseJiraKey = parseExternalKey;

/**
 * Collect unique project keys and iteration (sprint/cycle/list) names
 * present on the board, excluding manual tasks.
 */
export function extractExternalContext(tasks: Array<{ title: string; sprintName?: string | null; source?: string }>): {
  projectKeys: string[];
  iterationNames: string[];
  sources: string[];
} {
  const projectKeys = new Set<string>();
  const iterationNames = new Set<string>();
  const sources = new Set<string>();
  for (const t of tasks) {
    if (!t.source || t.source === 'manual') continue;
    sources.add(t.source);
    const key = parseExternalKey(t.title);
    if (key) {
      const project = key.split('-')[0];
      if (project) projectKeys.add(project);
    }
    if (t.sprintName) iterationNames.add(t.sprintName);
  }
  return {
    projectKeys: Array.from(projectKeys),
    iterationNames: Array.from(iterationNames),
    sources: Array.from(sources),
  };
}

/** Backwards-compat alias — use extractExternalContext. */
export function extractJiraContext(tasks: Array<{ title: string; sprintName?: string | null; source?: string }>) {
  const ctx = extractExternalContext(tasks);
  return { projectKeys: ctx.projectKeys, sprintNames: ctx.iterationNames };
}

/**
 * Compute the "today" column position on an agile board grid.
 * Returns -1 when today is outside [startDate, endDate] or dates are missing.
 */
export function computeTodayCol(
  startDate: string | null,
  endDate: string | null,
  totalCols: number,
  today: Date = new Date(),
): number {
  if (!startDate || !endDate || totalCols <= 0) return -1;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = today.getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return -1;
  if (now < start || now > end) return -1;
  const ratio = (now - start) / (end - start);
  return Math.round(ratio * (totalCols - 1));
}

/**
 * Classify a list of versions into 'past' / 'next' / 'later' / 'none' buckets.
 * Versions with a release date in the future: the first one (chronologically)
 * is 'next', the rest are 'later'. Versions without a release date stay 'none'.
 */
export function categorizeVersions(
  versions: Array<{ name: string; releaseDate: string | null }>,
  today: Date = new Date(),
): VersionInfo[] {
  const now = today.getTime();
  const withDate = versions
    .filter(v => !!v.releaseDate)
    .map(v => ({ ...v, _t: new Date(v.releaseDate as string).getTime() }))
    .filter(v => !isNaN(v._t))
    .sort((a, b) => a._t - b._t);

  const future = withDate.filter(v => v._t >= now);
  const past = withDate.filter(v => v._t < now);

  const result: VersionInfo[] = [];
  for (const v of past) {
    result.push({ name: v.name, releaseDate: v.releaseDate, category: 'past' });
  }
  future.forEach((v, idx) => {
    result.push({
      name: v.name,
      releaseDate: v.releaseDate,
      category: idx === 0 ? 'next' : 'later',
    });
  });
  const datelessNames = new Set(versions.filter(v => !v.releaseDate).map(v => v.name));
  for (const name of datelessNames) {
    if (!result.some(r => r.name === name)) {
      result.push({ name, releaseDate: null, category: 'none' });
    }
  }
  return result;
}

/** Category of a specific version name, given the classified set. */
export function categoryOf(versionName: string | null, versions: VersionInfo[]): VersionCategory {
  if (!versionName) return 'none';
  const found = versions.find(v => v.name === versionName);
  return found?.category ?? 'none';
}

// ============ AI analysis ============

export async function analyzeSanityCheck(
  userId: number,
  snapshot: BoardSnapshot,
  userEmail?: string | null,
): Promise<SanityCheckResult> {
  const stats = computeBoardAnalysis(snapshot);

  if (snapshot.tasks.length === 0 && snapshot.missingFromBoard.length === 0) {
    return { summary: 'Aucune tâche à analyser.', analysis: stats, columns: [] };
  }

  const startedAt = Date.now();
  const { client, model } = await getAnthropicClient(userId);

  const MAX_COL = snapshot.totalCols - 1;
  const MAX_ROWS_HINT = Math.max(
    ...snapshot.tasks.map(t => t.position.row),
    snapshot.tasks.length,
  );

  const tasksJson = snapshot.tasks.map(t => ({
    id: t.id,
    title: t.title,
    externalKey: t.externalKey,
    source: t.source,
    status: t.externalStatus ?? t.boardStatus,
    storyPoints: t.storyPoints,
    estimatedDays: t.estimatedDays,
    hasEstimation: t.hasEstimation,
    hasDescription: t.hasDescription,
    hasAssignee: t.hasAssignee,
    version: t.releaseTag,
    versionCategory: t.versionCategory,
    currentPosition: t.position,
    currentDuration: Math.max(1, t.position.endCol - t.position.startCol),
  }));

  const versionsSummary = snapshot.versions.length > 0
    ? snapshot.versions.map(v => `- ${v.name} (${v.category}${v.releaseDate ? `, ${v.releaseDate}` : ''})`).join('\n')
    : '(aucune version détectée sur les tickets)';

  const missingJson = snapshot.missingFromBoard.map(m => ({
    externalKey: m.externalKey,
    source: m.source,
    summary: m.summary,
    status: m.status,
    storyPoints: m.storyPoints,
    estimatedDays: m.estimatedDays,
    hasEstimation: m.hasEstimation,
    hasDescription: m.hasDescription,
    hasAssignee: !!m.assignee,
    version: m.releaseTag,
    versionCategory: m.versionCategory,
    iterationName: m.iterationName,
  }));

  // Editable skill rules — loaded from DB (admin override) or from
  // skill-reorganize-board.md as fallback. Edit from the admin UI
  // (Admin → AI Skills) or tweak the markdown file to change defaults.
  const skill = await loadSkill();
  const { hash: skillVersionHash } = await ensureSkillVersion(SKILL_SLUG, skill, null);

  const prompt = `${skill}

---

# Contexte exécutable (généré automatiquement à chaque appel)

## Board
- "${snapshot.boardName}" — ${snapshot.totalCols} colonnes (indexées 0 à ${MAX_COL}), chaque colonne = 1 semaine.
- Colonne "aujourd'hui" : ${snapshot.todayCol >= 0 ? snapshot.todayCol : '(hors timeframe)'}.
- Rows 0 (tout en haut) → ~${MAX_ROWS_HINT} (plus bas).

## Versions Jira détectées
${versionsSummary}

## Tickets sur le board (JSON)
${JSON.stringify(tasksJson, null, 2)}

## Tickets présents dans l'itération active (sprint / cycle / liste) mais ABSENTS du board (JSON)
${missingJson.length > 0 ? JSON.stringify(missingJson, null, 2) : '(aucun ticket manquant détecté)'}

Applique les règles ci-dessus à cet état et réponds uniquement en JSON.`;

  const aiResponse = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = aiResponse.content.find(b => b.type === 'text')?.type === 'text'
    ? (aiResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string }).text
    : '';
  const inputTokens = aiResponse.usage?.input_tokens ?? 0;
  const outputTokens = aiResponse.usage?.output_tokens ?? 0;
  logAnthropicUsage(userId, model, aiResponse.usage, `aiSkills:${SKILL_SLUG}`);

  let parsed: { summary?: string; columns?: unknown[] } = {};
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* parse error */
  }

  const taskById = new Map(snapshot.tasks.map(t => [t.id, t]));
  const missingByKey = new Map(snapshot.missingFromBoard.map(m => [m.externalKey, m]));
  const columns: ColumnPlan[] = [];
  const seenTaskIds = new Set<string>();
  const seenAdditionKeys = new Set<string>();
  const MAX_MOVES = 25;
  const MAX_ADDITIONS = 15;

  for (const rawCol of (parsed.columns || []) as Array<Record<string, unknown>>) {
    const col = clampInt(Number(rawCol.col), 0, MAX_COL);
    const label = String(rawCol.label || `Semaine ${col + 1}`).slice(0, 60);
    const strategy = String(rawCol.strategy || '').slice(0, 500);
    const plan: ColumnPlan = { col, label, strategy, tasks: [], additions: [] };

    for (const rawTask of (rawCol.tasks || []) as Array<Record<string, unknown>>) {
      if (seenTaskIds.size >= MAX_MOVES) break;
      const taskId = String(rawTask.taskId || '');
      if (seenTaskIds.has(taskId)) continue;
      const task = taskById.get(taskId);
      if (!task) continue;
      const rec = rawTask.recommended as { startCol?: number; row?: number } | undefined;
      if (!rec || typeof rec.startCol !== 'number') continue;

      // Width from estimation if available, else keep current duration
      const estWidth = widthFromEstimation(task.estimatedDays, task.storyPoints);
      const currentDuration = Math.max(1, task.position.endCol - task.position.startCol);
      const width = Math.max(1, Math.min(snapshot.totalCols, estWidth ?? currentDuration));
      const maxStartCol = Math.max(0, snapshot.totalCols - width);
      const startCol = clampInt(rec.startCol, 0, maxStartCol);
      const endCol = startCol + width;
      const row = clampInt(typeof rec.row === 'number' ? rec.row : task.position.row, 0, 99);

      // Skip no-op moves
      if (
        startCol === task.position.startCol &&
        endCol === task.position.endCol &&
        row === task.position.row
      ) continue;

      plan.tasks.push({
        taskId,
        taskTitle: task.title,
        externalKey: task.externalKey,
        source: task.source,
        status: task.externalStatus ?? task.boardStatus,
        version: task.releaseTag,
        versionCategory: task.versionCategory,
        hasEstimation: task.hasEstimation,
        hasDescription: task.hasDescription,
        current: task.position,
        recommended: { startCol, endCol, row },
        reasoning: String(rawTask.reasoning || '').slice(0, 300),
      });
      seenTaskIds.add(taskId);
    }

    for (const rawAdd of (rawCol.additions || []) as Array<Record<string, unknown>>) {
      if (seenAdditionKeys.size >= MAX_ADDITIONS) break;
      // Accept both legacy `jiraKey` and generic `externalKey` field names.
      const externalKey = String(rawAdd.externalKey || rawAdd.jiraKey || '');
      if (!externalKey || seenAdditionKeys.has(externalKey)) continue;
      const missing = missingByKey.get(externalKey);
      if (!missing) continue;
      const rec = rawAdd.recommended as { startCol?: number; row?: number } | undefined;
      if (!rec || typeof rec.startCol !== 'number') continue;

      // New tickets: width from estimation, else default to 1 column.
      const estWidth = widthFromEstimation(missing.estimatedDays, missing.storyPoints);
      const width = Math.max(1, Math.min(snapshot.totalCols, estWidth ?? 1));
      const maxStartCol = Math.max(0, snapshot.totalCols - width);
      const startCol = clampInt(rec.startCol, 0, maxStartCol);
      const endCol = startCol + width;
      const row = clampInt(typeof rec.row === 'number' ? rec.row : 0, 0, 99);

      plan.additions.push({
        externalKey,
        source: missing.source,
        summary: missing.summary,
        status: missing.status,
        version: missing.releaseTag,
        versionCategory: missing.versionCategory,
        hasEstimation: missing.hasEstimation,
        hasDescription: missing.hasDescription,
        storyPoints: missing.storyPoints,
        estimatedDays: missing.estimatedDays,
        assignee: missing.assignee,
        iterationName: missing.iterationName,
        recommended: { startCol, endCol, row },
        reasoning: String(rawAdd.reasoning || '').slice(0, 300),
      });
      seenAdditionKeys.add(externalKey);
    }

    if (plan.tasks.length > 0 || plan.additions.length > 0) columns.push(plan);
    if (seenTaskIds.size >= MAX_MOVES && seenAdditionKeys.size >= MAX_ADDITIONS) break;
  }

  columns.sort((a, b) => a.col - b.col);

  const logId = await logAnalysis({
    userId,
    userEmail: userEmail ?? null,
    skillSlug: SKILL_SLUG,
    sourceKind: 'board',
    sourceTitle: snapshot.boardName || 'Delivery board',
    documentId: null,
    inputContent: `Tickets: ${snapshot.tasks.length}\nMissing from board: ${snapshot.missingFromBoard.length}\nTotal columns: ${snapshot.totalCols}\nToday col: ${snapshot.todayCol}`,
    fullPrompt: prompt,
    aiOutputRaw: text,
    proposals: columns,
    durationMs: Date.now() - startedAt,
    skillVersionHash,
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens,
    costUsd: computeCostUsd(model, inputTokens, outputTokens),
  });

  const result: SanityCheckResult & { logId?: number | null } = {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : `${seenTaskIds.size} recommandation(s).`,
    analysis: stats,
    columns,
    logId,
  };

  return result;
}

// ============ Pure analysis ============

export function computeBoardAnalysis(snapshot: BoardSnapshot): BoardAnalysis {
  const byStatus: Record<string, number> = {};
  let missingEstimation = 0;
  let missingDescription = 0;
  for (const t of snapshot.tasks) {
    const status = (t.jiraStatus ?? t.boardStatus ?? 'inconnu').toLowerCase();
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (!t.hasEstimation) missingEstimation++;
    if (!t.hasDescription) missingDescription++;
  }
  return {
    totalJiraTasks: snapshot.tasks.length,
    byStatus,
    missingEstimation,
    missingDescription,
    missingFromBoard: snapshot.missingFromBoard.length,
    versions: snapshot.versions,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

/**
 * Convert an estimation (days, or fallback storyPoints treated as days) to a
 * column width : 1 column per 5 days (1 business week), rounded up.
 *   0.5 - 5   → 1 column
 *   5.1 - 10  → 2 columns
 *   10.1 - 15 → 3 columns …
 * Returns null when no usable estimation is available.
 */
export function widthFromEstimation(
  estimatedDays: number | null | undefined,
  storyPoints: number | null | undefined,
): number | null {
  const days = typeof estimatedDays === 'number' && estimatedDays > 0
    ? estimatedDays
    : (typeof storyPoints === 'number' && storyPoints > 0 ? storyPoints : null);
  if (days === null) return null;
  return Math.max(1, Math.ceil(days / 5));
}
