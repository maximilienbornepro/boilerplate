import { describe, it, expect } from 'vitest';
import {
  buildEnhancedTasks,
  VIRTUAL_DELIVERY_PARENT_ID,
  virtualDeliveryBoardId,
  virtualDeliveryTaskId,
  stripJiraKey,
} from '../utils/deliveryVirtualRow';
import type { Task, DeliveryOverlayTask } from '../types';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    planningId: 'plan-1',
    parentId: null,
    name: `Task ${overrides.id}`,
    description: null,
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    color: '#000000',
    progress: 0,
    sortOrder: 0,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  } as Task;
}

function makeOverlay(overrides: Partial<DeliveryOverlayTask> & { id: string }): DeliveryOverlayTask {
  return {
    boardId: 'board-1',
    boardName: 'My Board',
    title: `Overlay ${overrides.id}`,
    type: 'feature',
    status: 'todo',
    source: 'jira',
    startDate: '2026-04-05',
    endDate: '2026-04-12',
    incrementId: 'board-1_inc1',
    ...overrides,
  };
}

describe('stripJiraKey', () => {
  it('strips a leading Jira key with project code and number', () => {
    expect(stripJiraKey('[TVFIRE-1281] Fix login')).toBe('Fix login');
  });

  it('strips keys with any uppercase project code', () => {
    expect(stripJiraKey('[ABC-1] Do thing')).toBe('Do thing');
    expect(stripJiraKey('[PROJ-123] Another')).toBe('Another');
  });

  it('accepts leading whitespace', () => {
    expect(stripJiraKey('  [X-9] Trimmed')).toBe('Trimmed');
  });

  it('leaves titles without a key untouched', () => {
    expect(stripJiraKey('Just a title')).toBe('Just a title');
    expect(stripJiraKey('[not-a-key] mixed')).toBe('[not-a-key] mixed'); // lowercase code
  });

  it('never returns empty — falls back to original', () => {
    expect(stripJiraKey('[TVFIRE-1]')).toBe('[TVFIRE-1]');
  });
});

describe('buildEnhancedTasks — virtual Delivery row injection', () => {
  it('returns the original tasks array unchanged when overlay is empty', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    const result = buildEnhancedTasks(tasks, []);
    expect(result).toBe(tasks);
  });

  it('skips the board sub-parent when only 1 board is linked (leaves directly under Delivery)', () => {
    const overlay = [
      makeOverlay({ id: 'ov-1', boardId: 'only-board' }),
      makeOverlay({ id: 'ov-2', boardId: 'only-board' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    // 1 Delivery parent + 2 leaves = 3 (no board sub-parent)
    expect(result).toHaveLength(3);

    expect(result[0].id).toBe(VIRTUAL_DELIVERY_PARENT_ID);
    // No board sub-parent row for a single-board overlay
    expect(result.find(t => t.id === virtualDeliveryBoardId('only-board'))).toBeUndefined();

    // Leaves are direct children of the Delivery parent
    const leaf1 = result.find(t => t.id === virtualDeliveryTaskId('only-board', 'ov-1'))!;
    const leaf2 = result.find(t => t.id === virtualDeliveryTaskId('only-board', 'ov-2'))!;
    expect(leaf1.parentId).toBe(VIRTUAL_DELIVERY_PARENT_ID);
    expect(leaf2.parentId).toBe(VIRTUAL_DELIVERY_PARENT_ID);
  });

  it('builds a 3-level hierarchy when multiple boards are linked', () => {
    const tasks = [makeTask({ id: 'real-1' })];
    const overlay = [
      makeOverlay({ id: 'ov-1', boardId: 'b1', boardName: 'Board A' }),
      makeOverlay({ id: 'ov-2', boardId: 'b1', boardName: 'Board A' }),
      makeOverlay({ id: 'ov-3', boardId: 'b2', boardName: 'Board B' }),
    ];
    const result = buildEnhancedTasks(tasks, overlay);

    // 1 Delivery parent + 2 board sub-parents + 3 leaves + 1 real = 7
    expect(result).toHaveLength(7);

    // The virtual Delivery parent is first
    expect(result[0].id).toBe(VIRTUAL_DELIVERY_PARENT_ID);
    expect(result[0].parentId).toBeNull();
    expect(result[0].name).toBe('Delivery');

    // Board A sub-parent
    const boardA = result.find(t => t.id === virtualDeliveryBoardId('b1'))!;
    expect(boardA).toBeDefined();
    expect(boardA.parentId).toBe(VIRTUAL_DELIVERY_PARENT_ID);
    expect(boardA.name).toBe('Board A');
    expect(boardA.compact).toBeUndefined();

    // Board B sub-parent
    const boardB = result.find(t => t.id === virtualDeliveryBoardId('b2'))!;
    expect(boardB).toBeDefined();
    expect(boardB.parentId).toBe(VIRTUAL_DELIVERY_PARENT_ID);
    expect(boardB.name).toBe('Board B');

    // Leaves point to their respective board sub-parent
    const leaf1 = result.find(t => t.id === virtualDeliveryTaskId('b1', 'ov-1'))!;
    expect(leaf1.parentId).toBe(virtualDeliveryBoardId('b1'));
    const leaf3 = result.find(t => t.id === virtualDeliveryTaskId('b2', 'ov-3'))!;
    expect(leaf3.parentId).toBe(virtualDeliveryBoardId('b2'));
  });

  it('marks leaves as compact, parents as non-compact (multi-board)', () => {
    const overlay = [
      makeOverlay({ id: 'ov-1', boardId: 'b1', boardName: 'Board A' }),
      makeOverlay({ id: 'ov-2', boardId: 'b2', boardName: 'Board B' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    const deliveryParent = result.find(t => t.id === VIRTUAL_DELIVERY_PARENT_ID)!;
    const boardA = result.find(t => t.id === virtualDeliveryBoardId('b1'))!;
    const leaf = result.find(t => t.id === virtualDeliveryTaskId('b1', 'ov-1'))!;

    expect(deliveryParent.compact).toBeUndefined();
    expect(boardA.compact).toBeUndefined();
    expect(leaf.compact).toBe(true);
  });

  it('strips the Jira key from leaf names (multi-board case)', () => {
    const overlay = [
      makeOverlay({ id: 'a', title: '[TVFIRE-1281] Fix the login bug', boardId: 'b1', boardName: 'Board A' }),
      makeOverlay({ id: 'b', title: '[ACME-42] Do something',         boardId: 'b2', boardName: 'Board B' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    const leafA = result.find(t => t.id === virtualDeliveryTaskId('b1', 'a'))!;
    expect(leafA.name).toBe('Fix the login bug');

    // Board sub-parent keeps its raw name (no prefix to strip)
    const board = result.find(t => t.id === virtualDeliveryBoardId('b1'))!;
    expect(board.name).toBe('Board A');
  });

  it('derives the Delivery parent date range from the min/max of all overlay dates', () => {
    const overlay = [
      makeOverlay({ id: 'a', startDate: '2026-04-10', endDate: '2026-04-20' }),
      makeOverlay({ id: 'b', startDate: '2026-04-05', endDate: '2026-04-30' }),
      makeOverlay({ id: 'c', startDate: '2026-04-15', endDate: '2026-04-25' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    const parent = result.find(t => t.id === VIRTUAL_DELIVERY_PARENT_ID)!;
    expect(parent.startDate).toBe('2026-04-05');
    expect(parent.endDate).toBe('2026-04-30');
  });

  it('derives each board sub-parent date range from its own tasks only', () => {
    const overlay = [
      makeOverlay({ id: 'a1', boardId: 'b1', startDate: '2026-04-01', endDate: '2026-04-10' }),
      makeOverlay({ id: 'a2', boardId: 'b1', startDate: '2026-04-05', endDate: '2026-04-15' }),
      makeOverlay({ id: 'b1', boardId: 'b2', startDate: '2026-06-01', endDate: '2026-06-30' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    const boardA = result.find(t => t.id === virtualDeliveryBoardId('b1'))!;
    expect(boardA.startDate).toBe('2026-04-01');
    expect(boardA.endDate).toBe('2026-04-15');

    const boardB = result.find(t => t.id === virtualDeliveryBoardId('b2'))!;
    expect(boardB.startDate).toBe('2026-06-01');
    expect(boardB.endDate).toBe('2026-06-30');
  });

  it('marks every virtual task with isVirtual and readOnly flags', () => {
    const tasks = [makeTask({ id: 'real-1' })];
    const overlay = [makeOverlay({ id: 'ov-1' })];
    const result = buildEnhancedTasks(tasks, overlay);

    const virtuals = result.filter(t => t.id.startsWith('__virtual_'));
    expect(virtuals.length).toBeGreaterThan(0);
    for (const t of virtuals) {
      expect(t.readOnly).toBe(true);
      expect(t.isVirtual).toBe(true);
      expect(t.virtualSource).toBe('delivery');
    }

    // The real task must NOT be flagged as virtual
    const real = result.find(t => t.id === 'real-1')!;
    expect(real.isVirtual).toBeUndefined();
    expect(real.compact).toBeUndefined();
  });

  it('uses distinct board sub-parent ids when overlaying tasks from multiple boards', () => {
    const overlay = [
      makeOverlay({ id: 'same-task-id', boardId: 'board-A' }),
      makeOverlay({ id: 'same-task-id', boardId: 'board-B' }),
    ];
    const result = buildEnhancedTasks([], overlay);

    // 1 Delivery + 2 boards + 2 leaves = 5 unique ids
    expect(new Set(result.map(t => t.id)).size).toBe(5);
    expect(result.find(t => t.id === virtualDeliveryBoardId('board-A'))).toBeDefined();
    expect(result.find(t => t.id === virtualDeliveryBoardId('board-B'))).toBeDefined();
  });
});
