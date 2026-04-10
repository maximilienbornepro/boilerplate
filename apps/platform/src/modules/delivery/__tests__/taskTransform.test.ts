import { describe, it, expect } from 'vitest';
import { transformTask, buildTaskTree, computeContainerRowSpan } from '../utils/taskTransform';
import type { SavedPosition } from '../utils/taskTransform';
import type { TaskData } from '../services/api';
import type { Task } from '../types';

const MOCK_TASK_DATA: TaskData = {
  id: 'abc-123',
  title: 'Implementation du tracking',
  type: 'feature',
  status: 'todo',
  storyPoints: 5,
  assignee: 'John Doe',
  priority: 'medium',
  estimatedDays: 3,
  incrementId: 'board_s1',
  sprintName: 'Sprint 1',
  source: 'manual',
  parentTaskId: null,
};

const DEFAULT_PLACEMENT = { startCol: 0, endCol: 1, row: 0 };

// --- transformTask ---
describe('transformTask', () => {
  it('transforme une tâche avec les champs de base', () => {
    const task = transformTask(MOCK_TASK_DATA, undefined, DEFAULT_PLACEMENT);

    expect(task.id).toBe('abc-123');
    expect(task.title).toBe('Implementation du tracking');
    expect(task.type).toBe('feature');
    expect(task.status).toBe('todo');
    expect(task.storyPoints).toBe(5);
    expect(task.assignee).toBe('John Doe');
    expect(task.priority).toBe('medium');
    expect(task.estimatedDays).toBe(3);
  });

  it('mappe correctement le champ source', () => {
    const manual = transformTask({ ...MOCK_TASK_DATA, source: 'manual' }, undefined, DEFAULT_PLACEMENT);
    expect(manual.source).toBe('manual');

    const jira = transformTask({ ...MOCK_TASK_DATA, source: 'jira' }, undefined, DEFAULT_PLACEMENT);
    expect(jira.source).toBe('jira');
  });

  it('mappe correctement le champ parentTaskId', () => {
    const child = transformTask({ ...MOCK_TASK_DATA, parentTaskId: 'parent-id' }, undefined, DEFAULT_PLACEMENT);
    expect(child.parentTaskId).toBe('parent-id');

    const root = transformTask({ ...MOCK_TASK_DATA, parentTaskId: null }, undefined, DEFAULT_PLACEMENT);
    expect(root.parentTaskId).toBeNull();
  });

  it('utilise le placement par defaut quand pas de position sauvegardee', () => {
    const task = transformTask(MOCK_TASK_DATA, undefined, { startCol: 2, endCol: 3, row: 5 });

    expect(task.startCol).toBe(2);
    expect(task.endCol).toBe(3);
    expect(task.row).toBe(5);
    expect(task.rowSpan).toBe(1);
  });

  it('utilise la position sauvegardee si disponible', () => {
    const savedPos: SavedPosition = { taskId: 'abc-123', startCol: 4, endCol: 5, row: 10, rowSpan: 3 };
    const task = transformTask(MOCK_TASK_DATA, savedPos, DEFAULT_PLACEMENT);

    expect(task.startCol).toBe(4);
    expect(task.endCol).toBe(5);
    expect(task.row).toBe(10);
    expect(task.rowSpan).toBe(3);
  });

  it('rowSpan par defaut = 1 si non fourni dans savedPosition', () => {
    const savedPos: SavedPosition = { taskId: 'abc-123', startCol: 0, endCol: 2, row: 0 };
    const task = transformTask(MOCK_TASK_DATA, savedPos, DEFAULT_PLACEMENT);
    expect(task.rowSpan).toBe(1);
  });

  it('gere les valeurs nulles correctement', () => {
    const taskData: TaskData = {
      ...MOCK_TASK_DATA,
      storyPoints: null,
      estimatedDays: null,
      assignee: null,
      incrementId: null,
      sprintName: null,
    };
    const task = transformTask(taskData, undefined, DEFAULT_PLACEMENT);

    expect(task.storyPoints).toBeUndefined();
    expect(task.estimatedDays).toBeNull();
    expect(task.assignee).toBeNull();
  });
});

// --- buildTaskTree ---
describe('buildTaskTree', () => {
  const makeTask = (id: string, parentTaskId: string | null = null, source: Task['source'] = 'jira'): Task => ({
    id,
    title: `Task ${id}`,
    type: 'feature',
    status: 'todo',
    source,
    parentTaskId,
    startCol: 0,
    endCol: 2,
    row: 0,
    rowSpan: 1,
  });

  it('retourne toutes les taches sans parent si pas d\'arborescence', () => {
    const flat = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
    const tree = buildTaskTree(flat);
    expect(tree).toHaveLength(3);
    expect(tree.every(t => !t.parentTaskId)).toBe(true);
  });

  it('imbrique les enfants dans leur conteneur', () => {
    const tasks = [
      makeTask('container', null, 'manual'),
      makeTask('child1', 'container'),
      makeTask('child2', 'container'),
    ];
    const tree = buildTaskTree(tasks);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('container');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children!.map(c => c.id)).toContain('child1');
    expect(tree[0].children!.map(c => c.id)).toContain('child2');
  });

  it('exclude les enfants du niveau racine', () => {
    const tasks = [
      makeTask('container', null, 'manual'),
      makeTask('child', 'container'),
      makeTask('standalone'),
    ];
    const tree = buildTaskTree(tasks);

    expect(tree).toHaveLength(2); // container + standalone
    expect(tree.find(t => t.id === 'child')).toBeUndefined();
  });

  it('orphelin avec parentId inconnu reste au niveau racine', () => {
    const tasks = [makeTask('orphan', 'unknown-parent')];
    const tree = buildTaskTree(tasks);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('orphan');
  });

  it('retourne un tableau vide pour une liste vide', () => {
    expect(buildTaskTree([])).toEqual([]);
  });
});

// --- computeContainerRowSpan ---
describe('computeContainerRowSpan', () => {
  it('retourne 1 pour 0 enfants', () => {
    expect(computeContainerRowSpan(0)).toBe(1);
  });

  it('retourne 2 pour 1 enfant (ceil(1/2)+1)', () => {
    expect(computeContainerRowSpan(1)).toBe(2);
  });

  it('retourne 2 pour 2 enfants (ceil(2/2)+1)', () => {
    expect(computeContainerRowSpan(2)).toBe(2);
  });

  it('retourne 3 pour 3 enfants (ceil(3/2)+1)', () => {
    expect(computeContainerRowSpan(3)).toBe(3);
  });

  it('retourne 3 pour 4 enfants (ceil(4/2)+1)', () => {
    expect(computeContainerRowSpan(4)).toBe(3);
  });

  it('retourne 4 pour 5 enfants (ceil(5/2)+1)', () => {
    expect(computeContainerRowSpan(5)).toBe(4);
  });

  it('grandit proportionnellement avec le nombre d\'enfants', () => {
    const spans = [0, 1, 2, 3, 4, 5, 6, 10].map(n => computeContainerRowSpan(n));
    // Each span should be >= previous
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]).toBeGreaterThanOrEqual(spans[i - 1]);
    }
  });
});
