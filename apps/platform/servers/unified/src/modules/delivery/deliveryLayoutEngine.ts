// ═══════════════════════════════════════════════════════════════════════
// Pure layout engine for delivery board reorganization.
//
// This file replaces most of the LLM reasoning that lived inside the
// monolithic `delivery-reorganize-board` skill. Placement rules in that
// skill are deterministic (status → which part of the grid, version →
// column band, estimation → width, row packing) — we execute them in
// TypeScript instead of asking an LLM to interpret the rules each run.
//
// The LLM is only consulted for :
//   - tier 1 : qualityFlags on each ticket (does the description actually
//     say something useful, is the ticket ready, does it have risk notes)
//   - tier 2 : a natural-language `reasoning` sentence per movement
//
// Everything else — choosing the column, the row, detecting no-op moves,
// handling missing tickets as additions, clamping out-of-grid values — is
// handled here, tested in isolation with unit tests.
// ═══════════════════════════════════════════════════════════════════════

import type {
  TaskSnapshot,
  MissingTicket,
  VersionCategory,
} from './deliveryAISanityService.js';

// ── Types ─────────────────────────────────────────────────────────────

export type StatusCategory = 'done' | 'in_progress' | 'blocked' | 'todo';

export interface QualityFlags {
  hasEstimation: boolean;
  hasMeaningfulDescription: boolean;
  ready: boolean;
}

export interface TicketPlacement {
  taskId: string;
  /** Null for additions (no previous position on the board). */
  from: { startCol: number; endCol: number; row: number } | null;
  to: { startCol: number; endCol: number; row: number };
  isAddition: boolean;
  /** Fields copied from the ticket so the tier 2 reasoning skill has them
   *  without needing a second lookup. */
  status: string;
  statusCategory: StatusCategory;
  version: string | null;
  versionCategory: VersionCategory;
  qualityFlags: QualityFlags;
  /** Only set for additions — the `externalKey` we use to match back. */
  externalKey?: string;
  title?: string;
}

export interface BoardPlan {
  placements: TicketPlacement[];
  /** Tickets we intentionally left where they are (for transparency).
   *  Not returned to the UI — used by unit tests to verify the algorithm. */
  skipped: Array<{ taskId: string; reason: string }>;
}

export interface LayoutInput {
  tickets: TaskSnapshot[];
  missingFromBoard: MissingTicket[];
  /** Keyed by ticket.id — the LLM's tier-1 output. For tickets not in the
   *  map we fall back to raw `hasEstimation` / `hasDescription` from the
   *  snapshot (so the engine works without a tier-1 run too). */
  assessment: Record<string, QualityFlags>;
  grid: { totalCols: number; todayCol: number };
}

// ── Helpers ───────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Tickets in an "abandoned" workflow state must never surface on a
 *  delivery board — they were consciously dropped. Includes common Jira /
 *  ClickUp / Linear labels (FR + EN). Keep this list narrow on purpose :
 *  a false-positive silently drops work from the board. */
export function isAbandonedStatus(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.toLowerCase().trim();
  return (
    s === 'abandoned' ||
    s === 'abandonné' ||
    s === 'abandonne' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'annulé' ||
    s === 'annule' ||
    s === "won't do" ||
    s === 'wont do' ||
    s === "won't fix" ||
    s === 'wont fix' ||
    s === 'obsolete' ||
    s === 'rejected' ||
    s === 'rejeté' ||
    s === 'rejete' ||
    s === 'duplicate' ||
    s === 'dupliqué' ||
    s === 'duplique'
  );
}

/** Late-stage workflow states ("En revue", "Livraison", "QA", "Test") :
 *  work is essentially complete, so the ticket must NEVER be placed in
 *  the future. Business rule from the team :
 *    - Ticket already strictly before the today bar → leave it alone.
 *    - Ticket on today / in the future → move it to the week just before
 *      the today bar (endCol = todayCol).
 *  Detected here so the rule is shared between board repositionings and
 *  additions from the sprint. Kept narrow on purpose — false-positives
 *  would silently pull ongoing work into the past. */
export function isReviewOrDeliveryStatus(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.toLowerCase().trim();
  return (
    /\breview\b/.test(s) ||
    /\ben revue\b|\brevue\b/.test(s) ||
    /\blivraison\b|\ben livraison\b/.test(s) ||
    /\bdelivery\b/.test(s) ||
    /\bqa\b/.test(s) ||
    /\btest(ing|s)?\b|\ben test\b/.test(s) ||
    /\bverified\b|\bvérifié\b|\bverifie\b/.test(s) ||
    /\bvalidation\b|\ben validation\b|\bvalidated\b/.test(s) ||
    /\buat\b/.test(s) ||
    /\bstaging\b|\bpré-?prod\b|\bpre-?prod\b/.test(s) ||
    /\bready to deploy\b|\bprêt à déployer\b/.test(s)
  );
}

/** Single mapping to keep Jira/ClickUp/Linear status labels consistent.
 *  Any label we don't recognize defaults to `todo` (safest — ticket ends
 *  up on the right-hand side, user can re-check). */
export function statusCategory(raw: string | null | undefined): StatusCategory {
  if (!raw) return 'todo';
  const s = raw.toLowerCase().trim();
  if (/\bdone\b|terminé|termine|closed|resolved|fini/.test(s)) return 'done';
  if (/blocked|bloqué|bloque|blocker|impediment/.test(s)) return 'blocked';
  if (/progress|en cours|doing|review|qa|testing|test/.test(s)) return 'in_progress';
  return 'todo';
}

/** Estimation → width in columns. Matches the original skill's formula :
 *  0.5–5 days → 1 col, 5.1–10 → 2, 10.1–15 → 3, etc.
 *  Returns null when no estimation is available — caller keeps current width. */
export function widthFromEstimation(
  estimatedDays: number | null | undefined,
  storyPoints: number | null | undefined,
): number | null {
  const days = typeof estimatedDays === 'number' && estimatedDays > 0
    ? estimatedDays
    : typeof storyPoints === 'number' && storyPoints > 0
      ? storyPoints // fallback — treat 1 SP ≈ 1 day
      : null;
  if (days == null) return null;
  return Math.max(1, Math.ceil(days / 5));
}

/** Pick the target column based on status category + version category +
 *  today column. Returns the `startCol` for a width=1 ticket ; caller may
 *  adjust depending on actual width. Always clamped to the grid. */
export function chooseStartCol(
  statusCat: StatusCategory,
  versionCat: VersionCategory,
  todayCol: number,
  totalCols: number,
  width: number,
): number {
  const lastCol = Math.max(0, totalCols - width);
  // Rule 1 : done tickets stay strictly BEFORE today.
  if (statusCat === 'done') {
    if (todayCol <= 0) return 0;
    return clamp(todayCol - 1, 0, lastCol);
  }
  // Rule 2 : in_progress + blocked cover today (enforced later by
  //   ensureOverlapsToday). Here we just pick today - overlap/2 so a wide
  //   ticket is centered around today.
  if (statusCat === 'in_progress' || statusCat === 'blocked') {
    if (todayCol < 0) return 0;
    const centered = todayCol - Math.floor((width - 1) / 2);
    return clamp(centered, 0, lastCol);
  }
  // Rule 3 : todo — position by versionCategory bucket.
  //   next    → first third after today
  //   later   → second third
  //   past    → fin de board (puisque la version est déjà livrée, pas d'urgence)
  //   none    → fin de board
  const afterToday = Math.max(0, todayCol >= 0 ? todayCol + 1 : 0);
  const remaining = Math.max(1, totalCols - afterToday);
  let start: number;
  if (versionCat === 'next') {
    start = afterToday;
  } else if (versionCat === 'later') {
    start = afterToday + Math.floor(remaining / 3);
  } else {
    // past or none → fin de board
    start = afterToday + Math.floor((remaining * 2) / 3);
  }
  return clamp(start, 0, lastCol);
}

/** Guarantee an in_progress / blocked ticket's range [startCol, endCol]
 *  covers `todayCol`. Shifts left if the ticket ended before today, shifts
 *  right if it starts after. Returns the new startCol. */
export function ensureOverlapsToday(
  startCol: number,
  width: number,
  todayCol: number,
  totalCols: number,
): number {
  if (todayCol < 0) return startCol; // today outside the grid — no-op
  const endCol = startCol + width;
  if (endCol <= todayCol) {
    // ended before today → shift so endCol lands on todayCol + 1
    return clamp(todayCol + 1 - width, 0, Math.max(0, totalCols - width));
  }
  if (startCol > todayCol) {
    // starts after today → shift back so startCol = todayCol
    return clamp(todayCol, 0, Math.max(0, totalCols - width));
  }
  return startCol;
}

/** Inside a single column (same startCol), assign row numbers so that
 *  tickets don't overlap in time. Higher-quality tickets (ready, with
 *  description) go to low rows ; lower-quality ones go further down.
 *  Only packs tickets that END in this column or later — earlier tickets
 *  keep their own row.
 *
 *  Deterministic : given the same input order, always produces the same
 *  row assignment. */
export function packRows(
  column: Array<{ taskId: string; startCol: number; endCol: number; qualityFlags: QualityFlags }>,
): Map<string, number> {
  // Sort : ready first, then hasDescription, then hasEstimation, then taskId
  //   (stable tiebreaker).
  const sorted = [...column].sort((a, b) => {
    const aScore = (a.qualityFlags.ready ? 4 : 0)
      + (a.qualityFlags.hasMeaningfulDescription ? 2 : 0)
      + (a.qualityFlags.hasEstimation ? 1 : 0);
    const bScore = (b.qualityFlags.ready ? 4 : 0)
      + (b.qualityFlags.hasMeaningfulDescription ? 2 : 0)
      + (b.qualityFlags.hasEstimation ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore; // high score first → low row
    return a.taskId.localeCompare(b.taskId);
  });
  // Greedy row assignment : each ticket gets the lowest row where no
  // previously-placed ticket overlaps its [startCol, endCol[ range.
  const rows: Array<Array<{ startCol: number; endCol: number }>> = [];
  const out = new Map<string, number>();
  for (const t of sorted) {
    let assignedRow = -1;
    for (let r = 0; r < rows.length; r++) {
      const overlaps = rows[r].some(existing =>
        !(t.endCol <= existing.startCol || t.startCol >= existing.endCol));
      if (!overlaps) { assignedRow = r; break; }
    }
    if (assignedRow === -1) {
      rows.push([]);
      assignedRow = rows.length - 1;
    }
    rows[assignedRow].push({ startCol: t.startCol, endCol: t.endCol });
    out.set(t.taskId, assignedRow);
  }
  return out;
}

// ── Main entry point ──────────────────────────────────────────────────

/**
 * Compute the full reorganization plan for a board.
 * No LLM calls — pure function over (tickets + assessment + grid).
 * Caller wires this between tier 1 (assess) and tier 2 (write reasoning).
 */
export function computeBoardPlan(input: LayoutInput): BoardPlan {
  const { tickets, missingFromBoard, assessment, grid } = input;
  const placements: TicketPlacement[] = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];

  // ── 1. Repositionnements sur les tickets existants du board ──
  // Group by column first so we can pack rows consistently.
  const byTargetCol = new Map<number, Array<{
    ticket: TaskSnapshot;
    startCol: number; endCol: number;
    qualityFlags: QualityFlags;
    statusCat: StatusCategory;
  }>>();

  for (const t of tickets) {
    // Defense-in-depth : abandoned / cancelled tickets must never surface,
    // even if they slipped past the source-level filter in routes.ts.
    if (isAbandonedStatus(t.externalStatus ?? t.boardStatus)) {
      skipped.push({ taskId: t.id, reason: 'abandoned status' });
      continue;
    }
    const statusCat = statusCategory(t.externalStatus ?? t.boardStatus);
    const qf: QualityFlags = assessment[t.id] ?? {
      hasEstimation: t.hasEstimation,
      hasMeaningfulDescription: t.hasDescription,
      ready: t.hasEstimation && t.hasDescription && statusCat !== 'blocked',
    };
    const currentDuration = Math.max(1, t.position.endCol - t.position.startCol);
    const estWidth = widthFromEstimation(t.estimatedDays, t.storyPoints);
    const width = Math.max(1, Math.min(grid.totalCols, estWidth ?? currentDuration));

    const rawStatus = t.externalStatus ?? t.boardStatus;
    let startCol: number;
    let endCol: number;

    // Rule : review / delivery / QA / validation tickets are essentially
    // done and must NEVER sit in the future. If they're already strictly
    // before the today bar, keep them put (no spurious move proposal).
    // Otherwise, snap them to the slot ending exactly on the today bar.
    if (isReviewOrDeliveryStatus(rawStatus) && grid.todayCol > 0) {
      if (t.position.endCol <= grid.todayCol) {
        // Already in the past — leave it. Using the current position means
        // the no-op skip below will prune this placement automatically.
        startCol = t.position.startCol;
        endCol = t.position.endCol;
      } else {
        endCol = grid.todayCol;
        startCol = clamp(grid.todayCol - width, 0, Math.max(0, grid.totalCols - width));
        endCol = startCol + width;
      }
    } else {
      startCol = chooseStartCol(statusCat, t.versionCategory, grid.todayCol, grid.totalCols, width);
      if (statusCat === 'in_progress' || statusCat === 'blocked') {
        startCol = ensureOverlapsToday(startCol, width, grid.todayCol, grid.totalCols);
      }
      endCol = startCol + width;
    }

    const bucket = byTargetCol.get(startCol) ?? [];
    bucket.push({ ticket: t, startCol, endCol, qualityFlags: qf, statusCat });
    byTargetCol.set(startCol, bucket);
  }

  // Row packing per target column.
  for (const [col, bucket] of byTargetCol) {
    const rowMap = packRows(bucket.map(b => ({
      taskId: b.ticket.id,
      startCol: b.startCol,
      endCol: b.endCol,
      qualityFlags: b.qualityFlags,
    })));
    for (const b of bucket) {
      const row = rowMap.get(b.ticket.id) ?? 0;
      const to = { startCol: b.startCol, endCol: b.endCol, row };
      // Skip no-op moves — same startCol, endCol, row as current position.
      if (
        b.ticket.position.startCol === to.startCol &&
        b.ticket.position.endCol === to.endCol &&
        b.ticket.position.row === to.row
      ) {
        skipped.push({ taskId: b.ticket.id, reason: 'already well placed' });
        continue;
      }
      placements.push({
        taskId: b.ticket.id,
        from: { ...b.ticket.position },
        to,
        isAddition: false,
        status: b.ticket.externalStatus ?? b.ticket.boardStatus,
        statusCategory: b.statusCat,
        version: b.ticket.releaseTag,
        versionCategory: b.ticket.versionCategory,
        qualityFlags: b.qualityFlags,
        title: b.ticket.title,
      });
    }
    void col;
  }

  // ── 2. Additions depuis missingFromBoard ──
  // Same placement logic as todo tickets, row = after all existing tickets in the target column.
  const additionsByCol = new Map<number, Array<{
    missing: MissingTicket;
    startCol: number; endCol: number;
    qualityFlags: QualityFlags;
    statusCat: StatusCategory;
  }>>();

  for (const m of missingFromBoard) {
    // Abandoned / cancelled tickets are never re-proposed as additions,
    // regardless of their sprint membership.
    if (isAbandonedStatus(m.status)) {
      skipped.push({ taskId: m.externalKey, reason: 'abandoned status' });
      continue;
    }
    const statusCat = statusCategory(m.status);
    const qf: QualityFlags = assessment[m.externalKey] ?? {
      hasEstimation: m.hasEstimation,
      hasMeaningfulDescription: m.hasDescription,
      ready: m.hasEstimation && m.hasDescription && statusCat !== 'blocked',
    };
    const estWidth = widthFromEstimation(m.estimatedDays, m.storyPoints);
    const width = Math.max(1, Math.min(grid.totalCols, estWidth ?? 1));
    let startCol: number;
    let endCol: number;

    // Same past-only rule as above — additions in review/delivery state
    // are pulled in from the sprint but are essentially done, so they go
    // straight to the slot ending on the today bar.
    if (isReviewOrDeliveryStatus(m.status) && grid.todayCol > 0) {
      endCol = grid.todayCol;
      startCol = clamp(grid.todayCol - width, 0, Math.max(0, grid.totalCols - width));
      endCol = startCol + width;
    } else {
      startCol = chooseStartCol(statusCat, m.versionCategory, grid.todayCol, grid.totalCols, width);
      if (statusCat === 'in_progress' || statusCat === 'blocked') {
        startCol = ensureOverlapsToday(startCol, width, grid.todayCol, grid.totalCols);
      }
      endCol = startCol + width;
    }
    const bucket = additionsByCol.get(startCol) ?? [];
    bucket.push({ missing: m, startCol, endCol, qualityFlags: qf, statusCat });
    additionsByCol.set(startCol, bucket);
  }

  for (const [col, bucket] of additionsByCol) {
    // Start rows for additions after the max row already used by existing
    // tickets in the same column — so additions appear below repositioned
    // tickets rather than on top of them.
    const baseRow = Math.max(
      0,
      ...placements
        .filter(p => p.to.startCol === col)
        .map(p => p.to.row + 1),
    );
    const rowMap = packRows(bucket.map(b => ({
      taskId: b.missing.externalKey,
      startCol: b.startCol,
      endCol: b.endCol,
      qualityFlags: b.qualityFlags,
    })));
    for (const b of bucket) {
      const row = (rowMap.get(b.missing.externalKey) ?? 0) + baseRow;
      placements.push({
        taskId: b.missing.externalKey, // additions keyed by external key
        from: null,
        to: { startCol: b.startCol, endCol: b.endCol, row },
        isAddition: true,
        status: b.missing.status,
        statusCategory: b.statusCat,
        version: b.missing.releaseTag,
        versionCategory: b.missing.versionCategory,
        qualityFlags: b.qualityFlags,
        externalKey: b.missing.externalKey,
        title: b.missing.summary,
      });
    }
  }

  return { placements, skipped };
}
