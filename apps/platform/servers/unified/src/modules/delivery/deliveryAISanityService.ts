// AI-powered delivery board sanity check.
// Compares live Jira state (status/estimation) with current board positions
// and returns move recommendations — never deletes a task, only repositions.

import { getAnthropicClient } from '../connectors/aiProvider.js';

// ============ Public types ============

export interface TaskSnapshot {
  id: string;
  title: string;
  jiraKey: string | null;
  boardStatus: string;
  jiraStatus: string | null;
  storyPoints: number | null;
  estimatedDays: number | null;
  hasEstimation: boolean;
  hasDescription: boolean;
  hasAssignee: boolean;
  position: { startCol: number; endCol: number; row: number };
}

export interface BoardSnapshot {
  boardId: string;
  boardName: string;
  totalCols: number;
  todayCol: number; // -1 if board not in a timeframe that contains today
  tasks: TaskSnapshot[];
}

export interface MoveRecommendation {
  taskId: string;
  taskTitle: string;
  current: { startCol: number; endCol: number; row: number };
  recommended: { startCol: number; endCol: number; row: number };
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SanityCheckResult {
  summary: string;
  recommendations: MoveRecommendation[];
}

// ============ Helpers ============

/**
 * Parse the Jira issue key from a task title (format "[KEY-123] Summary").
 * Returns null if not Jira-sourced or title does not follow the pattern.
 */
export function parseJiraKey(title: string): string | null {
  const match = title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
  return match ? match[1] : null;
}

/**
 * Extract the (projectKeys, sprintNames) context present on the board.
 * Used to decide whether the feature can run and which Jira keys to query.
 */
export function extractJiraContext(tasks: Array<{ title: string; sprintName?: string | null; source?: string }>): {
  projectKeys: string[];
  sprintNames: string[];
} {
  const projectKeys = new Set<string>();
  const sprintNames = new Set<string>();
  for (const t of tasks) {
    if (t.source !== 'jira') continue;
    const key = parseJiraKey(t.title);
    if (key) {
      const project = key.split('-')[0];
      if (project) projectKeys.add(project);
    }
    if (t.sprintName) sprintNames.add(t.sprintName);
  }
  return {
    projectKeys: Array.from(projectKeys),
    sprintNames: Array.from(sprintNames),
  };
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

// ============ AI analysis ============

/**
 * Run the AI sanity check. Expects a BoardSnapshot and returns a
 * SanityCheckResult. Never mutates input data — callers are responsible
 * for persisting the moves if the user accepts them.
 */
export async function analyzeSanityCheck(
  userId: number,
  snapshot: BoardSnapshot,
): Promise<SanityCheckResult> {
  if (snapshot.tasks.length === 0) {
    return { summary: 'Aucune tâche à analyser.', recommendations: [] };
  }

  const { client, model } = await getAnthropicClient(userId);

  const MAX_COL = snapshot.totalCols - 1;
  const MAX_ROWS_HINT = Math.max(
    ...snapshot.tasks.map(t => t.position.row),
    snapshot.tasks.length,
  );

  const tasksJson = snapshot.tasks.map(t => ({
    id: t.id,
    title: t.title,
    jiraKey: t.jiraKey,
    boardStatus: t.boardStatus,
    jiraStatus: t.jiraStatus,
    storyPoints: t.storyPoints,
    estimatedDays: t.estimatedDays,
    hasEstimation: t.hasEstimation,
    hasDescription: t.hasDescription,
    hasAssignee: t.hasAssignee,
    position: t.position,
  }));

  const prompt = `Tu es un assistant de gestion de projet. Tu analyses l'état d'un delivery board (grille temporelle) pour proposer des repositionnements de tâches.

## Contexte du board
- Board "${snapshot.boardName}" avec ${snapshot.totalCols} colonnes (indexées de 0 à ${MAX_COL}).
- Colonne "aujourd'hui" : ${snapshot.todayCol >= 0 ? snapshot.todayCol : '(hors timeframe)'}.
- Plus la colonne est basse, plus on est tôt dans le temps. Plus elle est haute, plus on est tard.
- Les rows (lignes) vont de 0 (en haut) à environ ${MAX_ROWS_HINT} (en bas). Une row basse signifie visuellement en bas de la grille.

## Règles de repositionnement (impératives)
1. Ne jamais supprimer de tâche. Ne propose que des changements de position (startCol, endCol, row).
2. Ne jamais modifier le statut ni l'estimation — on touche uniquement la position.
3. Si la tâche est \`in_progress\` côté Jira ET positionnée loin à droite d'"aujourd'hui" → rapproche-la d'"aujourd'hui" (startCol proche de todayCol, legèrement avant).
4. Si la tâche est \`blocked\` → laisse-la près d'"aujourd'hui" (signal visuel). Priorité high.
5. Si la tâche est \`done\` mais positionnée sur le futur (startCol > todayCol) → tire-la à gauche (avant todayCol).
6. Si la tâche est \`todo\` ET sans estimation ET sans description → pousse-la tout à droite (startCol proche de ${MAX_COL}), row basse. MAIS les tâches qui ont encore moins d'infos doivent être plus basses qu'elle. Ordre vertical (row croissante = plus bas) : plus la tâche a d'infos (estimation + description + assignee), plus elle est haute ; moins elle en a, plus elle est basse.
7. Si la tâche est \`todo\` avec estimation précise ET courte à venir → aligne-la juste avant "aujourd'hui" ou sur todayCol.
8. Conserve une durée raisonnable : endCol - startCol >= 1. Si la tâche a estimatedDays, essaie d'adapter la durée (1 semaine ≈ 1 colonne sur un board agile).
9. Pas de chevauchement obligatoire à régler. Tu peux réutiliser les mêmes rows que d'autres tâches.
10. Réponds UNIQUEMENT avec les tâches qui ont besoin d'un repositionnement. Ne réemet pas celles déjà bien placées.

## État courant (JSON)
${JSON.stringify(tasksJson, null, 2)}

## Format de réponse (JSON strict, rien d'autre)
{
  "summary": "Résumé court en 1-2 phrases en français (ex: '4 tâches à repositionner, dont 1 critique bloquée').",
  "recommendations": [
    {
      "taskId": "uuid-de-la-tache",
      "current":     { "startCol": 0, "endCol": 1, "row": 0 },
      "recommended": { "startCol": 2, "endCol": 3, "row": 1 },
      "reasoning": "Une phrase en français expliquant pourquoi ce déplacement.",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Limite-toi à 20 recommandations maximum, priorisées. Utilise des priorités 'high' pour les bloqués / en cours mal placés, 'medium' pour les done mal placés, 'low' pour le rangement des todos incomplets.`;

  const aiResponse = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = aiResponse.content.find(b => b.type === 'text')?.type === 'text'
    ? (aiResponse.content.find(b => b.type === 'text') as { type: 'text'; text: string }).text
    : '';

  let parsed: { summary?: string; recommendations?: unknown[] } = {};
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* parse error */
  }

  const validTaskIds = new Set(snapshot.tasks.map(t => t.id));
  const recommendations: MoveRecommendation[] = [];
  for (const raw of (parsed.recommendations || []) as Array<Record<string, unknown>>) {
    const taskId = String(raw.taskId || '');
    if (!validTaskIds.has(taskId)) continue;
    const current = raw.current as { startCol?: number; endCol?: number; row?: number } | undefined;
    const recommended = raw.recommended as { startCol?: number; endCol?: number; row?: number } | undefined;
    if (!recommended || typeof recommended.startCol !== 'number') continue;

    const task = snapshot.tasks.find(t => t.id === taskId)!;
    const startCol = clampInt(recommended.startCol, 0, MAX_COL);
    const endCol = clampInt(
      typeof recommended.endCol === 'number' ? recommended.endCol : startCol + 1,
      startCol + 1,
      snapshot.totalCols,
    );
    const row = clampInt(typeof recommended.row === 'number' ? recommended.row : task.position.row, 0, 99);

    // Skip no-op moves
    if (
      startCol === task.position.startCol &&
      endCol === task.position.endCol &&
      row === task.position.row
    ) continue;

    const priorityRaw = String(raw.priority || 'medium').toLowerCase();
    const priority: 'high' | 'medium' | 'low' =
      priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium';

    recommendations.push({
      taskId,
      taskTitle: task.title,
      current: current && typeof current.startCol === 'number'
        ? { startCol: current.startCol, endCol: current.endCol ?? task.position.endCol, row: current.row ?? task.position.row }
        : task.position,
      recommended: { startCol, endCol, row },
      reasoning: String(raw.reasoning || '').slice(0, 300),
      priority,
    });

    if (recommendations.length >= 20) break;
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : `${recommendations.length} recommandation(s).`,
    recommendations,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}
