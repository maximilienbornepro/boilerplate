// ═══════════════════════════════════════════════════════════════════════
// Modular reorganize-board pipeline for delivery.
//
// Replaces the monolithic `delivery-reorganize-board` skill (which did
// assessment + placement + reasoning in one ~150-line LLM prompt) with
// a hybrid : two small LLM skills sandwich a deterministic layout engine.
//
//   Tier 1  delivery-assess-tickets      (LLM — 1 call)
//           → qualityFlags per ticket (hasEstimation / hasMeaningfulDescription
//             / ready / riskNotes)
//
//   Layout  deliveryLayoutEngine.computeBoardPlan  (pure TS, tested)
//           → placement per ticket (startCol / row) + additions from
//             missingFromBoard, enforcing the 'in_progress covers today'
//             rule deterministically
//
//   Tier 2  delivery-write-reasoning     (LLM — 1 call)
//           → one natural-language reasoning per placement
//
// Output shape is identical to the legacy analyzeSanityCheck so the
// route handler and the frontend need no changes.
// ═══════════════════════════════════════════════════════════════════════

import { runSkill } from '../aiSkills/runSkill.js';
import { attachProposalsToLog } from '../aiSkills/analysisLogsService.js';
import {
  computeBoardPlan,
  type QualityFlags,
  type TicketPlacement,
} from './deliveryLayoutEngine.js';
import {
  computeBoardAnalysis,
  type BoardSnapshot,
  type SanityCheckResult,
  type AnalyzedTask,
  type ProposedAddition,
  type ColumnPlan,
} from './deliveryAISanityService.js';

// ── Tier output shapes (what the LLM skills return) ───────────────────

interface AssessmentEntry {
  id: string;
  qualityFlags: QualityFlags;
  riskNotes?: string[];
}

interface ReasoningEntry {
  taskId: string;
  reasoning: string;
}

// ── Tolerant JSON extractor (handles fences, prose, truncation). ─────

function extractJson<T>(text: string): T | null {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const arr = s.match(/\[[\s\S]*\]/);
  const obj = s.match(/\{[\s\S]*\}/);
  try {
    if (arr && (!obj || (arr.index ?? 0) < (obj.index ?? Infinity))) {
      return JSON.parse(arr[0]) as T;
    }
    if (obj) return JSON.parse(obj[0]) as T;
  } catch { /* ignore */ }
  return null;
}

function fmtDur(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s (${ms}ms)`;
}

// ── Tier 1 — assess tickets with the LLM ──────────────────────────────

async function runAssess(input: {
  userId: number;
  userEmail: string | null;
  snapshot: BoardSnapshot;
}): Promise<{ logId: number | null; assessment: Record<string, QualityFlags> }> {
  const t0 = Date.now();

  // Minimal payload : just the content fields, no placement info.
  const tickets = [
    ...input.snapshot.tasks.map(t => ({
      id: t.id,
      title: t.title,
      description_present: t.hasDescription,
      estimation: t.estimatedDays ?? t.storyPoints ?? null,
      status: t.externalStatus ?? t.boardStatus,
      version: t.releaseTag,
    })),
    ...input.snapshot.missingFromBoard.map(m => ({
      id: m.externalKey,          // additions keyed by externalKey (same as layout engine)
      title: m.summary,
      description_present: m.hasDescription,
      estimation: m.estimatedDays ?? m.storyPoints ?? null,
      status: m.status,
      version: m.releaseTag,
    })),
  ];

  const ctxJson = JSON.stringify(tickets, null, 2).slice(0, 30000);
  const run = await runSkill({
    slug: 'delivery-assess-tickets',
    userId: input.userId,
    userEmail: input.userEmail,
    buildContext: () => `## Tickets à évaluer\n\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des évaluations.`,
    inputContent: ctxJson,
    sourceKind: 'board',
    sourceTitle: input.snapshot.boardName || 'Delivery board',
    documentId: input.snapshot.boardId,
    maxTokens: 4000,
  });

  const raw = extractJson<AssessmentEntry[]>(run.outputText) ?? [];
  const assessment: Record<string, QualityFlags> = {};
  for (const e of raw) {
    if (e && typeof e.id === 'string' && e.qualityFlags) {
      assessment[e.id] = {
        hasEstimation: !!e.qualityFlags.hasEstimation,
        hasMeaningfulDescription: !!e.qualityFlags.hasMeaningfulDescription,
        ready: !!e.qualityFlags.ready,
      };
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[delivery-pipeline] tier1 assess → ${Object.keys(assessment).length} flagged · ${fmtDur(Date.now() - t0)} · logId=${run.logId}`);
  if (run.logId != null) await attachProposalsToLog(run.logId, raw);
  return { logId: run.logId, assessment };
}

// ── Tier 2 — write one reasoning per placement ────────────────────────

async function runReasoning(input: {
  userId: number;
  userEmail: string | null;
  snapshot: BoardSnapshot;
  placements: TicketPlacement[];
  parentLogId: number | null;
}): Promise<{ logId: number | null; reasonings: Record<string, string> }> {
  const t0 = Date.now();
  if (input.placements.length === 0) {
    return { logId: null, reasonings: {} };
  }

  const plan = input.placements.map(p => ({
    taskId: p.taskId,
    title: p.title ?? null,
    status: p.status,
    statusCategory: p.statusCategory,
    version: p.version,
    versionCategory: p.versionCategory,
    qualityFlags: p.qualityFlags,
    from: p.from ? { col: p.from.startCol } : null,
    to: { col: p.to.startCol, row: p.to.row },
    isAddition: p.isAddition,
  }));
  const ctxJson = JSON.stringify({ plan }, null, 2).slice(0, 30000);
  const run = await runSkill({
    slug: 'delivery-write-reasoning',
    userId: input.userId,
    userEmail: input.userEmail,
    buildContext: () => `## Plan à justifier\n\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON { taskId, reasoning }.`,
    inputContent: ctxJson,
    sourceKind: 'board',
    sourceTitle: input.snapshot.boardName || 'Delivery board',
    documentId: input.snapshot.boardId,
    parentLogId: input.parentLogId,
    maxTokens: 4000,
  });

  const raw = extractJson<ReasoningEntry[]>(run.outputText) ?? [];
  const reasonings: Record<string, string> = {};
  for (const e of raw) {
    if (e && typeof e.taskId === 'string' && typeof e.reasoning === 'string') {
      reasonings[e.taskId] = e.reasoning.slice(0, 300);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[delivery-pipeline] tier2 reasoning → ${Object.keys(reasonings).length}/${input.placements.length} · ${fmtDur(Date.now() - t0)} · logId=${run.logId}`);
  if (run.logId != null) await attachProposalsToLog(run.logId, raw);
  return { logId: run.logId, reasonings };
}

// ── Public entry point ────────────────────────────────────────────────

/**
 * Drop-in replacement for `analyzeSanityCheck` that uses the modular
 * pipeline. Same signature, same output shape.
 */
export async function analyzeSanityCheckPipeline(
  userId: number,
  snapshot: BoardSnapshot,
  userEmail?: string | null,
): Promise<SanityCheckResult> {
  const wallStart = Date.now();
  const stats = computeBoardAnalysis(snapshot);

  if (snapshot.tasks.length === 0 && snapshot.missingFromBoard.length === 0) {
    return { summary: 'Aucune tâche à analyser.', analysis: stats, columns: [] };
  }

  // ── Tier 1 : assess ──
  const assess = await runAssess({ userId, userEmail: userEmail ?? null, snapshot });

  // ── Layout engine : compute placements ──
  const plan = computeBoardPlan({
    tickets: snapshot.tasks,
    missingFromBoard: snapshot.missingFromBoard,
    assessment: assess.assessment,
    grid: { totalCols: snapshot.totalCols, todayCol: snapshot.todayCol },
  });

  // Clamp : respect the same maxes the legacy route enforced.
  const MAX_MOVES = 25;
  const MAX_ADDITIONS = 15;
  const moves = plan.placements.filter(p => !p.isAddition).slice(0, MAX_MOVES);
  const additions = plan.placements.filter(p => p.isAddition).slice(0, MAX_ADDITIONS);
  const kept = [...moves, ...additions];

  // ── Tier 2 : write reasoning for each kept placement ──
  const reasoning = await runReasoning({
    userId,
    userEmail: userEmail ?? null,
    snapshot,
    placements: kept,
    parentLogId: assess.logId,
  });

  // ── Shape the result to match SanityCheckResult ──
  const taskById = new Map(snapshot.tasks.map(t => [t.id, t]));
  const missingByKey = new Map(snapshot.missingFromBoard.map(m => [m.externalKey, m]));
  const columns = new Map<number, ColumnPlan>();
  const ensureCol = (col: number): ColumnPlan => {
    let c = columns.get(col);
    if (!c) {
      c = { col, label: `Semaine ${col + 1}`, strategy: '', tasks: [], additions: [] };
      columns.set(col, c);
    }
    return c;
  };

  for (const p of moves) {
    const t = taskById.get(p.taskId);
    if (!t) continue;
    const c = ensureCol(p.to.startCol);
    const analyzed: AnalyzedTask = {
      taskId: p.taskId,
      taskTitle: t.title,
      externalKey: t.externalKey,
      source: t.source,
      status: p.status,
      version: p.version,
      versionCategory: p.versionCategory,
      hasEstimation: p.qualityFlags.hasEstimation,
      hasDescription: p.qualityFlags.hasMeaningfulDescription,
      current: t.position,
      recommended: { startCol: p.to.startCol, endCol: p.to.endCol, row: p.to.row },
      reasoning: reasoning.reasonings[p.taskId] ?? '(sans justification)',
    };
    c.tasks.push(analyzed);
  }
  for (const p of additions) {
    const key = p.externalKey ?? p.taskId;
    const m = missingByKey.get(key);
    if (!m) continue;
    const c = ensureCol(p.to.startCol);
    const proposed: ProposedAddition = {
      externalKey: key,
      source: m.source,
      summary: m.summary,
      status: p.status,
      version: p.version,
      versionCategory: p.versionCategory,
      hasEstimation: p.qualityFlags.hasEstimation,
      hasDescription: p.qualityFlags.hasMeaningfulDescription,
      storyPoints: m.storyPoints,
      estimatedDays: m.estimatedDays,
      assignee: m.assignee,
      iterationName: m.iterationName,
      recommended: { startCol: p.to.startCol, endCol: p.to.endCol, row: p.to.row },
      reasoning: reasoning.reasonings[key] ?? '(sans justification)',
    };
    c.additions.push(proposed);
  }

  // Build a short column strategy from the tickets placed there.
  for (const c of columns.values()) {
    const total = c.tasks.length + c.additions.length;
    const statusCounts = new Map<string, number>();
    for (const t of c.tasks) statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
    for (const a of c.additions) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
    const breakdown = [...statusCounts.entries()]
      .map(([s, n]) => `${n} ${s}`)
      .join(', ');
    c.strategy = total === 0
      ? 'Colonne vide.'
      : `${total} ticket(s) : ${breakdown}.`;
  }

  const columnsArr = [...columns.values()].sort((a, b) => a.col - b.col);
  const totalMs = Date.now() - wallStart;
  // eslint-disable-next-line no-console
  console.log(`[delivery-pipeline:summary] ${moves.length} moves + ${additions.length} additions · ${fmtDur(totalMs)}`);

  return {
    summary: `${moves.length} repositionnement(s) et ${additions.length} ajout(s) proposés.`,
    analysis: stats,
    columns: columnsArr,
  };
}
