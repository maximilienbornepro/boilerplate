import type { Task, DeliveryOverlayTask } from '../types';

/**
 * Synthetic id of the top-level virtual "Delivery" parent row.
 * Exported so handlers can guard against it.
 */
export const VIRTUAL_DELIVERY_PARENT_ID = '__virtual_delivery__';

/** Sub-parent id for a specific delivery board, nested under VIRTUAL_DELIVERY_PARENT_ID. */
export function virtualDeliveryBoardId(boardId: string): string {
  return `__virtual_delivery_board_${boardId}__`;
}

/** Leaf id for a specific delivery task, nested under its board sub-parent. */
export function virtualDeliveryTaskId(boardId: string, taskId: string): string {
  return `__virtual_delivery_${boardId}_${taskId}__`;
}

/**
 * Strip a leading Jira key like `[TVFIRE-1281] ` from a title.
 * Case-insensitive on the project key for flexibility.
 */
export function stripJiraKey(title: string): string {
  return title.replace(/^\s*\[[A-Za-z][A-Za-z0-9]*-\d+\]\s*/, '').trim() || title;
}

function minIso(dates: string[]): string {
  return dates.reduce((min, d) => (d < min ? d : min), dates[0]);
}

function maxIso(dates: string[]): string {
  return dates.reduce((max, d) => (d > max ? d : max), dates[0]);
}

/**
 * Prepend a virtual hierarchy to the real task list returned by the
 * roadmap API. Shape depends on the number of linked boards:
 *
 *   Single board:
 *     Delivery (parent, level 0, normal size)
 *       ├─ Task 1 (leaf, level 1, COMPACT row)
 *       └─ Task 2 (leaf, level 1, COMPACT row)
 *
 *   Multiple boards:
 *     Delivery (parent, level 0, normal size)
 *       ├─ [Board A] (sub-parent, level 1, normal size)
 *       │    ├─ Task 1 (leaf, level 2, COMPACT row)
 *       │    └─ Task 2 (leaf, level 2, COMPACT row)
 *       └─ [Board B] (sub-parent, level 1, normal size)
 *            └─ Task 3 (leaf, level 2, COMPACT row)
 *
 * When only ONE board is linked the board sub-parent is redundant (the
 * "Delivery" row already represents it), so we collapse the hierarchy.
 *
 * Every virtual task carries `isVirtual: true` and `readOnly: true`. Leaves
 * additionally have `compact: true` so GanttBoard renders them on a thin
 * row instead of the default 80px row.
 *
 * Jira tickets are stripped of their key prefix (e.g. `[TVFIRE-1281] `)
 * since the board already identifies the context.
 *
 * If the overlay is empty, returns the original `tasks` array unchanged.
 */
export function buildEnhancedTasks(
  tasks: Task[],
  overlay: DeliveryOverlayTask[]
): Task[] {
  if (!overlay || overlay.length === 0) return tasks;

  const planningId = tasks[0]?.planningId ?? '';
  const nowIso = new Date().toISOString();

  // Group by board, preserving first-seen order.
  const byBoard = new Map<string, { boardName: string; items: DeliveryOverlayTask[] }>();
  for (const item of overlay) {
    const bucket = byBoard.get(item.boardId);
    if (bucket) {
      bucket.items.push(item);
    } else {
      byBoard.set(item.boardId, { boardName: item.boardName, items: [item] });
    }
  }

  const hasMultipleBoards = byBoard.size > 1;

  // Level 0: "Delivery" parent, date range = min/max across all overlay tasks.
  const parent: Task = {
    id: VIRTUAL_DELIVERY_PARENT_ID,
    planningId,
    parentId: null,
    name: 'Delivery',
    description: null,
    startDate: minIso(overlay.map(o => o.startDate)),
    endDate: maxIso(overlay.map(o => o.endDate)),
    color: '#7280a0',
    progress: 0,
    sortOrder: -1,
    createdAt: nowIso,
    updatedAt: nowIso,
    readOnly: true,
    isVirtual: true,
    virtualSource: 'delivery',
  };

  const virtualRows: Task[] = [parent];

  const makeLeaf = (
    o: DeliveryOverlayTask,
    parentVirtualId: string,
    leafIndex: number
  ): Task => ({
    id: virtualDeliveryTaskId(o.boardId, o.id),
    planningId,
    parentId: parentVirtualId,
    name: stripJiraKey(o.title),
    description: null,
    startDate: o.startDate,
    endDate: o.endDate,
    color: o.source === 'jira' ? '#0052cc' : '#5a6f8c',
    progress: 0,
    sortOrder: leafIndex,
    createdAt: nowIso,
    updatedAt: nowIso,
    readOnly: true,
    isVirtual: true,
    virtualSource: 'delivery',
    compact: true,
  });

  if (hasMultipleBoards) {
    // Level 1: board sub-parents. Level 2: leaves under each board.
    let boardIndex = 0;
    for (const [boardId, { boardName, items }] of byBoard) {
      const boardParent: Task = {
        id: virtualDeliveryBoardId(boardId),
        planningId,
        parentId: VIRTUAL_DELIVERY_PARENT_ID,
        name: boardName,
        description: null,
        startDate: minIso(items.map(i => i.startDate)),
        endDate: maxIso(items.map(i => i.endDate)),
        color: '#5a6f8c',
        progress: 0,
        sortOrder: boardIndex,
        createdAt: nowIso,
        updatedAt: nowIso,
        readOnly: true,
        isVirtual: true,
        virtualSource: 'delivery',
      };
      virtualRows.push(boardParent);
      items.forEach((o, leafIndex) => {
        virtualRows.push(makeLeaf(o, boardParent.id, leafIndex));
      });
      boardIndex += 1;
    }
  } else {
    // Single board: skip the sub-parent and nest leaves directly under "Delivery".
    const onlyEntry = byBoard.values().next().value;
    if (onlyEntry) {
      onlyEntry.items.forEach((o, leafIndex) => {
        virtualRows.push(makeLeaf(o, VIRTUAL_DELIVERY_PARENT_ID, leafIndex));
      });
    }
  }

  return [...virtualRows, ...tasks];
}
