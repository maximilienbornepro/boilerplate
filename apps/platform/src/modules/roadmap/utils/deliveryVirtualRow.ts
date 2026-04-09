import type { Task, DeliveryOverlayTask } from '../types';
import { getStatusColor, normalizeStatus } from './statusColors';

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
 *       ├─ Manual container (leaf OR container, level 1, COMPACT row)
 *       │    └─ Jira child (level 2, COMPACT row)
 *       └─ Standalone Jira (level 1, COMPACT row)
 *
 *   Multiple boards:
 *     Delivery (parent, level 0, normal size)
 *       ├─ [Board A] (sub-parent, level 1, normal size)
 *       │    ├─ Manual container (level 2, COMPACT row)
 *       │    │    └─ Jira child (level 3, COMPACT row)
 *       │    └─ Standalone Jira (level 2, COMPACT row)
 *       └─ [Board B] (sub-parent, level 1, normal size)
 *            └─ Jira (level 2, COMPACT row)
 *
 * When only ONE board is linked the board sub-parent is redundant (the
 * "Delivery" row already represents it), so we collapse the hierarchy.
 *
 * When a delivery task has a `parentTaskId` that points to ANOTHER task in
 * the same board overlay, we preserve that relationship by nesting the
 * virtual leaf under its parent's virtual leaf — matching delivery's
 * manual-container → Jira-child model.
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

  /**
   * Build a leaf Task for a delivery overlay item. The parent of the leaf
   * depends on the delivery task's own `parentTaskId`:
   *   - If the delivery task is a child of another task that is also in
   *     this board's overlay, the leaf nests under that parent's virtual id.
   *   - Otherwise, the leaf nests directly under `fallbackParentId` (which
   *     is either the Delivery parent or the Board sub-parent).
   */
  const makeLeaf = (
    o: DeliveryOverlayTask,
    fallbackParentId: string,
    boardTaskIds: Set<string>,
    leafIndex: number
  ): Task => {
    const nestsUnderDeliveryParent =
      o.parentTaskId !== null && boardTaskIds.has(o.parentTaskId);
    const parentId = nestsUnderDeliveryParent
      ? virtualDeliveryTaskId(o.boardId, o.parentTaskId!)
      : fallbackParentId;

    // Delivery stores raw localized statuses (e.g. "Terminé", "En Cours",
    // "À faire"); normalize them to the 3 simple buckets so the color map
    // and the dot renderer agree — exactly like delivery's own dots do.
    const simpleStatus = normalizeStatus(o.status);

    return {
      id: virtualDeliveryTaskId(o.boardId, o.id),
      planningId,
      parentId,
      name: stripJiraKey(o.title),
      description: null,
      startDate: o.startDate,
      endDate: o.endDate,
      // Bar color matches the status dot so the two visual cues stay in sync.
      color: getStatusColor(simpleStatus),
      progress: 0,
      sortOrder: leafIndex,
      createdAt: nowIso,
      updatedAt: nowIso,
      readOnly: true,
      isVirtual: true,
      virtualSource: 'delivery',
      compact: true,
      status: simpleStatus,
    };
  };

  if (hasMultipleBoards) {
    // Level 1: board sub-parents. Level 2+: leaves under each board.
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

      const boardTaskIds = new Set(items.map(i => i.id));
      items.forEach((o, leafIndex) => {
        virtualRows.push(makeLeaf(o, boardParent.id, boardTaskIds, leafIndex));
      });
      boardIndex += 1;
    }
  } else {
    // Single board: skip the sub-parent and nest leaves directly under "Delivery".
    const onlyEntry = byBoard.values().next().value;
    if (onlyEntry) {
      const boardTaskIds = new Set(onlyEntry.items.map((i: DeliveryOverlayTask) => i.id));
      onlyEntry.items.forEach((o: DeliveryOverlayTask, leafIndex: number) => {
        virtualRows.push(
          makeLeaf(o, VIRTUAL_DELIVERY_PARENT_ID, boardTaskIds, leafIndex)
        );
      });
    }
  }

  return [...virtualRows, ...tasks];
}
