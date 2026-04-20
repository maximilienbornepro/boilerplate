import { describe, it, expect } from 'vitest';
import {
  statusCategory,
  isAbandonedStatus,
  isReviewOrDeliveryStatus,
  widthFromEstimation,
  chooseStartCol,
  ensureOverlapsToday,
  packRows,
  computeBoardPlan,
  type QualityFlags,
} from '../../delivery/deliveryLayoutEngine.js';
import type { TaskSnapshot, MissingTicket } from '../../delivery/deliveryAISanityService.js';

// Helpers ─────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<TaskSnapshot>): TaskSnapshot {
  return {
    id: 't-' + Math.random().toString(36).slice(2, 8),
    title: 'Test ticket',
    externalKey: null,
    source: 'jira',
    boardStatus: 'todo',
    externalStatus: null,
    storyPoints: null,
    estimatedDays: null,
    hasEstimation: false,
    hasDescription: false,
    hasAssignee: false,
    releaseTag: null,
    versionCategory: 'none',
    position: { startCol: 0, endCol: 1, row: 0 },
    ...overrides,
  };
}

function makeMissing(overrides: Partial<MissingTicket>): MissingTicket {
  return {
    externalKey: 'DEV-' + Math.floor(Math.random() * 1000),
    source: 'jira',
    summary: 'Missing ticket',
    status: 'todo',
    storyPoints: null,
    estimatedDays: null,
    hasEstimation: false,
    hasDescription: false,
    assignee: null,
    releaseTag: null,
    versionCategory: 'none',
    iterationName: 'Sprint 42',
    ...overrides,
  };
}

// ── statusCategory ────────────────────────────────────────────────────

describe('statusCategory', () => {
  it('recognizes Done / Fini / Closed as done', () => {
    expect(statusCategory('Done')).toBe('done');
    expect(statusCategory('Fini')).toBe('done');
    expect(statusCategory('Closed')).toBe('done');
    expect(statusCategory('Resolved')).toBe('done');
    expect(statusCategory('Terminé')).toBe('done');
  });
  it('recognizes En cours / In Progress / Review as in_progress', () => {
    expect(statusCategory('En cours')).toBe('in_progress');
    expect(statusCategory('In Progress')).toBe('in_progress');
    expect(statusCategory('Code Review')).toBe('in_progress');
    expect(statusCategory('QA')).toBe('in_progress');
  });
  it('recognizes Bloqué / Blocked / Impediment as blocked', () => {
    expect(statusCategory('Bloqué')).toBe('blocked');
    expect(statusCategory('Blocked')).toBe('blocked');
    expect(statusCategory('Impediment')).toBe('blocked');
  });
  it('defaults to todo for unknown / To Do / Backlog', () => {
    expect(statusCategory('To Do')).toBe('todo');
    expect(statusCategory('Backlog')).toBe('todo');
    expect(statusCategory('Something weird')).toBe('todo');
    expect(statusCategory(null)).toBe('todo');
    expect(statusCategory('')).toBe('todo');
  });
});

// ── isAbandonedStatus ─────────────────────────────────────────────────

describe('isAbandonedStatus', () => {
  it('flags abandoned / cancelled / rejected / wont-do labels (FR + EN)', () => {
    expect(isAbandonedStatus('Abandoned')).toBe(true);
    expect(isAbandonedStatus('Abandonné')).toBe(true);
    expect(isAbandonedStatus('abandonne')).toBe(true);
    expect(isAbandonedStatus('Cancelled')).toBe(true);
    expect(isAbandonedStatus('Canceled')).toBe(true);
    expect(isAbandonedStatus('Annulé')).toBe(true);
    expect(isAbandonedStatus("Won't Do")).toBe(true);
    expect(isAbandonedStatus("Won't Fix")).toBe(true);
    expect(isAbandonedStatus('Rejected')).toBe(true);
    expect(isAbandonedStatus('Rejeté')).toBe(true);
    expect(isAbandonedStatus('Obsolete')).toBe(true);
    expect(isAbandonedStatus('Duplicate')).toBe(true);
  });
  it('does not flag active / done / blocked statuses', () => {
    expect(isAbandonedStatus('To Do')).toBe(false);
    expect(isAbandonedStatus('In Progress')).toBe(false);
    expect(isAbandonedStatus('Done')).toBe(false);
    expect(isAbandonedStatus('Terminé')).toBe(false);
    expect(isAbandonedStatus('Blocked')).toBe(false);
    expect(isAbandonedStatus(null)).toBe(false);
    expect(isAbandonedStatus('')).toBe(false);
  });
});

// ── isReviewOrDeliveryStatus ──────────────────────────────────────────

describe('isReviewOrDeliveryStatus', () => {
  it('flags review / livraison / QA / validation / test labels (FR + EN)', () => {
    expect(isReviewOrDeliveryStatus('Review')).toBe(true);
    expect(isReviewOrDeliveryStatus('En revue')).toBe(true);
    expect(isReviewOrDeliveryStatus('Code Review')).toBe(true);
    expect(isReviewOrDeliveryStatus('Livraison')).toBe(true);
    expect(isReviewOrDeliveryStatus('En livraison')).toBe(true);
    expect(isReviewOrDeliveryStatus('Delivery')).toBe(true);
    expect(isReviewOrDeliveryStatus('QA')).toBe(true);
    expect(isReviewOrDeliveryStatus('Testing')).toBe(true);
    expect(isReviewOrDeliveryStatus('En test')).toBe(true);
    expect(isReviewOrDeliveryStatus('In Test')).toBe(true);
    expect(isReviewOrDeliveryStatus('Validation')).toBe(true);
    expect(isReviewOrDeliveryStatus('En validation')).toBe(true);
    expect(isReviewOrDeliveryStatus('UAT')).toBe(true);
    expect(isReviewOrDeliveryStatus('Staging')).toBe(true);
    expect(isReviewOrDeliveryStatus('Ready to deploy')).toBe(true);
  });
  it('does not flag todo / in-progress / done / blocked statuses', () => {
    expect(isReviewOrDeliveryStatus('To Do')).toBe(false);
    expect(isReviewOrDeliveryStatus('In Progress')).toBe(false);
    expect(isReviewOrDeliveryStatus('En cours')).toBe(false);
    expect(isReviewOrDeliveryStatus('Done')).toBe(false);
    expect(isReviewOrDeliveryStatus('Terminé')).toBe(false);
    expect(isReviewOrDeliveryStatus('Blocked')).toBe(false);
    expect(isReviewOrDeliveryStatus(null)).toBe(false);
    expect(isReviewOrDeliveryStatus('')).toBe(false);
  });
});

describe('computeBoardPlan — review/delivery past-only rule', () => {
  it('leaves a review ticket alone when already strictly before the today bar', () => {
    const plan = computeBoardPlan({
      tickets: [
        makeTicket({
          id: 'past-review',
          externalStatus: 'En revue',
          position: { startCol: 0, endCol: 1, row: 0 },
        }),
      ],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 6, todayCol: 3 },
    });
    // Ticket's endCol (1) <= todayCol (3), so no move should be proposed.
    expect(plan.placements.find(p => p.taskId === 'past-review')).toBeUndefined();
    expect(plan.skipped.some(s => s.taskId === 'past-review')).toBe(true);
  });

  it('moves a review ticket from the future to the slot ending on the today bar', () => {
    const plan = computeBoardPlan({
      tickets: [
        makeTicket({
          id: 'future-review',
          externalStatus: 'En revue',
          position: { startCol: 4, endCol: 5, row: 0 },
        }),
      ],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 6, todayCol: 3 },
    });
    const placement = plan.placements.find(p => p.taskId === 'future-review');
    expect(placement).toBeDefined();
    // Width 1 ticket ending at todayCol (3) → startCol = 2, endCol = 3.
    expect(placement!.to.endCol).toBe(3);
    expect(placement!.to.startCol).toBe(2);
  });

  it('moves a delivery ticket currently overlapping today backwards', () => {
    const plan = computeBoardPlan({
      tickets: [
        makeTicket({
          id: 'delivery-over-today',
          externalStatus: 'En livraison',
          position: { startCol: 3, endCol: 4, row: 0 },
        }),
      ],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 6, todayCol: 3 },
    });
    const placement = plan.placements.find(p => p.taskId === 'delivery-over-today');
    expect(placement).toBeDefined();
    expect(placement!.to.endCol).toBe(3);
  });

  it('respects the width of wider review tickets when snapping to the past', () => {
    const plan = computeBoardPlan({
      tickets: [
        makeTicket({
          id: 'wide-review',
          externalStatus: 'Code Review',
          estimatedDays: 10, // → width 2
          hasEstimation: true,
          position: { startCol: 4, endCol: 6, row: 0 },
        }),
      ],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 6, todayCol: 3 },
    });
    const placement = plan.placements.find(p => p.taskId === 'wide-review');
    expect(placement).toBeDefined();
    // Width 2, endCol must be 3 → startCol = 1, endCol = 3.
    expect(placement!.to.startCol).toBe(1);
    expect(placement!.to.endCol).toBe(3);
  });

  it('places review additions from the sprint directly in the past slot', () => {
    const plan = computeBoardPlan({
      tickets: [],
      missingFromBoard: [
        makeMissing({ externalKey: 'DEV-99', status: 'En revue' }),
      ],
      assessment: {},
      grid: { totalCols: 6, todayCol: 3 },
    });
    const addition = plan.placements.find(p => p.externalKey === 'DEV-99');
    expect(addition).toBeDefined();
    expect(addition!.isAddition).toBe(true);
    expect(addition!.to.endCol).toBe(3);
  });
});

describe('computeBoardPlan — abandoned filter', () => {
  it('does not propose additions for abandoned missing tickets', () => {
    const plan = computeBoardPlan({
      tickets: [],
      missingFromBoard: [
        makeMissing({ externalKey: 'DEV-1', status: 'To Do' }),
        makeMissing({ externalKey: 'DEV-2', status: 'Cancelled' }),
        makeMissing({ externalKey: 'DEV-3', status: "Won't Do" }),
      ],
      assessment: {},
      grid: { totalCols: 6, todayCol: 2 },
    });
    const additions = plan.placements.filter(p => p.isAddition);
    const keys = additions.map(a => a.externalKey);
    expect(keys).toContain('DEV-1');
    expect(keys).not.toContain('DEV-2');
    expect(keys).not.toContain('DEV-3');
    expect(plan.skipped.some(s => s.reason === 'abandoned status')).toBe(true);
  });
  it('skips existing board tickets whose external status became abandoned', () => {
    const plan = computeBoardPlan({
      tickets: [
        makeTicket({ id: 'keep', externalStatus: 'In Progress' }),
        makeTicket({ id: 'drop', externalStatus: 'Abandonné' }),
      ],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 6, todayCol: 2 },
    });
    const taskIds = plan.placements.map(p => p.taskId);
    expect(taskIds).not.toContain('drop');
    expect(plan.skipped.some(s => s.taskId === 'drop' && s.reason === 'abandoned status')).toBe(true);
  });
});

// ── widthFromEstimation ───────────────────────────────────────────────

describe('widthFromEstimation', () => {
  it('returns null when no estimation available', () => {
    expect(widthFromEstimation(null, null)).toBeNull();
    expect(widthFromEstimation(0, 0)).toBeNull();
  });
  it('maps 0.5–5 days to 1 column', () => {
    expect(widthFromEstimation(0.5, null)).toBe(1);
    expect(widthFromEstimation(3, null)).toBe(1);
    expect(widthFromEstimation(5, null)).toBe(1);
  });
  it('maps 5.1–10 days to 2 columns', () => {
    expect(widthFromEstimation(5.1, null)).toBe(2);
    expect(widthFromEstimation(7, null)).toBe(2);
    expect(widthFromEstimation(10, null)).toBe(2);
  });
  it('maps 10.1–15 days to 3 columns', () => {
    expect(widthFromEstimation(12, null)).toBe(3);
  });
  it('uses storyPoints as fallback', () => {
    expect(widthFromEstimation(null, 3)).toBe(1);
    expect(widthFromEstimation(null, 8)).toBe(2);
  });
  it('prefers estimatedDays over storyPoints when both present', () => {
    expect(widthFromEstimation(7, 3)).toBe(2); // uses 7 days, not 3 SP
  });
});

// ── chooseStartCol ────────────────────────────────────────────────────

describe('chooseStartCol', () => {
  it('places done tickets strictly before todayCol', () => {
    expect(chooseStartCol('done', 'none', 5, 12, 1)).toBe(4);
    expect(chooseStartCol('done', 'none', 0, 12, 1)).toBe(0);
  });
  it('centers in_progress tickets around todayCol', () => {
    expect(chooseStartCol('in_progress', 'next', 5, 12, 1)).toBe(5);
    // width=2 → centered: startCol=5 (so ticket covers cols 5-6, today is 5)
    const w2 = chooseStartCol('in_progress', 'next', 5, 12, 2);
    expect(w2).toBe(5);
  });
  it('places todo + next in the first third after today', () => {
    const col = chooseStartCol('todo', 'next', 2, 12, 1);
    expect(col).toBe(3); // immediately after today
  });
  it('places todo + later further than next', () => {
    const colNext = chooseStartCol('todo', 'next', 2, 12, 1);
    const colLater = chooseStartCol('todo', 'later', 2, 12, 1);
    expect(colLater).toBeGreaterThan(colNext);
  });
  it('places todo + none at the end of the board', () => {
    const colNone = chooseStartCol('todo', 'none', 2, 12, 1);
    const colNext = chooseStartCol('todo', 'next', 2, 12, 1);
    expect(colNone).toBeGreaterThan(colNext);
    expect(colNone).toBeGreaterThanOrEqual(8);
  });
  it('clamps to totalCols - width', () => {
    expect(chooseStartCol('todo', 'none', 0, 5, 3)).toBeLessThanOrEqual(2);
  });
});

// ── ensureOverlapsToday — the rule the user specifically asked for ────

describe('ensureOverlapsToday — in_progress tickets MUST cover today', () => {
  it('leaves alone tickets that already overlap today', () => {
    // startCol=3, width=2, today=4 → covers 3-4 → overlaps ✓
    expect(ensureOverlapsToday(3, 2, 4, 12)).toBe(3);
  });
  it('shifts right a ticket that ends before today', () => {
    // startCol=1, width=2, today=5 → covers 1-2, ends before today → shift
    const newStart = ensureOverlapsToday(1, 2, 5, 12);
    expect(newStart + 2).toBeGreaterThan(5); // endCol > today
    expect(newStart).toBeLessThanOrEqual(5); // startCol <= today
  });
  it('shifts left a ticket that starts after today', () => {
    // startCol=7, width=1, today=5 → shift back so startCol=5
    expect(ensureOverlapsToday(7, 1, 5, 12)).toBe(5);
  });
  it('no-op when todayCol < 0 (board outside timeframe)', () => {
    expect(ensureOverlapsToday(3, 2, -1, 12)).toBe(3);
  });
  it('clamps to grid bounds when shifting', () => {
    // totalCols=5, width=3, today=4 (last col) → startCol should be 2 max
    const s = ensureOverlapsToday(0, 3, 4, 5);
    expect(s).toBeLessThanOrEqual(2);
    expect(s + 3).toBeGreaterThan(4);
  });
});

// ── packRows ──────────────────────────────────────────────────────────

describe('packRows', () => {
  it('assigns row 0 to a single ticket', () => {
    const qf = makeQF(true, true, true);
    const m = packRows([{ taskId: 'a', startCol: 2, endCol: 3, qualityFlags: qf }]);
    expect(m.get('a')).toBe(0);
  });
  it('assigns the same row to two non-overlapping tickets', () => {
    const qf = makeQF(true, true, true);
    const m = packRows([
      { taskId: 'a', startCol: 0, endCol: 2, qualityFlags: qf },
      { taskId: 'b', startCol: 2, endCol: 4, qualityFlags: qf },
    ]);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(0);
  });
  it('assigns different rows to two overlapping tickets', () => {
    const qf = makeQF(true, true, true);
    const m = packRows([
      { taskId: 'a', startCol: 0, endCol: 3, qualityFlags: qf },
      { taskId: 'b', startCol: 2, endCol: 5, qualityFlags: qf },
    ]);
    expect(m.get('a')).not.toBe(m.get('b'));
  });
  it('places higher-quality tickets on lower rows', () => {
    const m = packRows([
      { taskId: 'low', startCol: 0, endCol: 1, qualityFlags: makeQF(false, false, false) },
      { taskId: 'high', startCol: 0, endCol: 1, qualityFlags: makeQF(true, true, true) },
    ]);
    expect(m.get('high')).toBeLessThan(m.get('low')!);
  });
});

function makeQF(est: boolean, desc: boolean, ready: boolean): QualityFlags {
  return { hasEstimation: est, hasMeaningfulDescription: desc, ready };
}

// ── computeBoardPlan (end-to-end) ─────────────────────────────────────

describe('computeBoardPlan — end-to-end', () => {
  it('produces zero placements on an empty board', () => {
    const p = computeBoardPlan({
      tickets: [],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    expect(p.placements).toHaveLength(0);
  });

  it('moves a done ticket to before today and an in_progress to today', () => {
    const tDone = makeTicket({
      id: 'done-1', boardStatus: 'Done',
      position: { startCol: 8, endCol: 9, row: 0 },
    });
    const tDoing = makeTicket({
      id: 'doing-1', boardStatus: 'In Progress',
      position: { startCol: 0, endCol: 1, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [tDone, tDoing],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    const doneMove = p.placements.find(x => x.taskId === 'done-1');
    const doingMove = p.placements.find(x => x.taskId === 'doing-1');
    expect(doneMove?.to.endCol).toBeLessThanOrEqual(5);
    // In-progress MUST cover today (rule : in_progress → overlaps todayCol).
    expect(doingMove?.to.startCol).toBeLessThanOrEqual(5);
    expect(doingMove?.to.endCol).toBeGreaterThan(5);
  });

  it('enforces the in_progress-overlaps-today rule even for wide tickets', () => {
    // 2-week ticket, today at col 5
    const t = makeTicket({
      id: 'wide-1', boardStatus: 'En cours', estimatedDays: 7,
      position: { startCol: 0, endCol: 2, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    const move = p.placements.find(x => x.taskId === 'wide-1');
    expect(move).toBeDefined();
    const { startCol, endCol } = move!.to;
    expect(endCol - startCol).toBe(2); // width preserved
    expect(startCol).toBeLessThanOrEqual(5);
    expect(endCol).toBeGreaterThan(5);
  });

  it('enforces the rule for blocked tickets too', () => {
    const t = makeTicket({
      id: 'blocked-1', boardStatus: 'Blocked',
      position: { startCol: 0, endCol: 1, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    const move = p.placements.find(x => x.taskId === 'blocked-1');
    expect(move).toBeDefined();
    expect(move!.to.startCol).toBeLessThanOrEqual(5);
    expect(move!.to.endCol).toBeGreaterThan(5);
  });

  it('skips no-op moves (ticket already well placed)', () => {
    // Done ticket at col 4, today is col 5 → should already be placed correctly.
    const t = makeTicket({
      id: 'good-1', boardStatus: 'Done',
      position: { startCol: 4, endCol: 5, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    expect(p.placements.find(x => x.taskId === 'good-1')).toBeUndefined();
    expect(p.skipped.some(s => s.taskId === 'good-1')).toBe(true);
  });

  it('flags additions with isAddition=true and places them like todos', () => {
    const m = makeMissing({
      externalKey: 'DEV-42', status: 'todo', versionCategory: 'next',
    });
    const p = computeBoardPlan({
      tickets: [],
      missingFromBoard: [m],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    const add = p.placements.find(x => x.externalKey === 'DEV-42');
    expect(add?.isAddition).toBe(true);
    expect(add?.from).toBeNull();
    expect(add?.to.startCol).toBeGreaterThan(5); // after today for a 'next' todo
  });

  it('places todo + none at the end of the board', () => {
    const t = makeTicket({
      id: 'rando', boardStatus: 'To Do', versionCategory: 'none',
      position: { startCol: 0, endCol: 1, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 3 },
    });
    const move = p.placements.find(x => x.taskId === 'rando');
    expect(move!.to.startCol).toBeGreaterThanOrEqual(8); // right side of the grid
  });

  it('respects assessment override for quality flags', () => {
    const t = makeTicket({
      id: 'x', hasEstimation: true, hasDescription: true,
      boardStatus: 'To Do', versionCategory: 'next',
      position: { startCol: 0, endCol: 1, row: 0 },
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {
        // LLM determined description is NOT meaningful
        x: { hasEstimation: true, hasMeaningfulDescription: false, ready: false },
      },
      grid: { totalCols: 12, todayCol: 3 },
    });
    const move = p.placements.find(x => x.taskId === 'x');
    expect(move?.qualityFlags.ready).toBe(false);
    expect(move?.qualityFlags.hasMeaningfulDescription).toBe(false);
  });

  it('width from estimation is respected in the output', () => {
    const t = makeTicket({
      id: 'w', boardStatus: 'En cours', estimatedDays: 8,
      position: { startCol: 0, endCol: 1, row: 0 }, // currently 1 col wide
    });
    const p = computeBoardPlan({
      tickets: [t],
      missingFromBoard: [],
      assessment: {},
      grid: { totalCols: 12, todayCol: 5 },
    });
    const move = p.placements.find(x => x.taskId === 'w');
    expect(move!.to.endCol - move!.to.startCol).toBe(2); // 8 days → 2 cols
  });
});
