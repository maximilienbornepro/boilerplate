import { describe, it, expect } from 'vitest';
import { transformTask } from '../utils/taskTransform';
import type { SavedPosition } from '../utils/taskTransform';
import type { TaskData } from '../services/api';

const MOCK_TASK_DATA: TaskData = {
  id: 'abc-123',
  title: 'Implementation du tracking',
  type: 'feature',
  status: 'todo',
  storyPoints: 5,
  assignee: 'John Doe',
  priority: 'medium',
  estimatedDays: 3,
  incrementId: 'inc1',
  sprintName: 'Sprint 1',
};

const DEFAULT_PLACEMENT = { startCol: 0, endCol: 1, row: 0 };

// --- transformTask ---
describe('transformTask', () => {
  it('transforme une tache avec les champs de base', () => {
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

  it('utilise le placement par defaut quand pas de position sauvegardee', () => {
    const task = transformTask(MOCK_TASK_DATA, undefined, { startCol: 2, endCol: 3, row: 5 });

    expect(task.startCol).toBe(2);
    expect(task.endCol).toBe(3);
    expect(task.row).toBe(5);
  });

  it('utilise la position sauvegardee si disponible', () => {
    const savedPos: SavedPosition = { taskId: 'abc-123', startCol: 4, endCol: 5, row: 10 };
    const task = transformTask(MOCK_TASK_DATA, savedPos, DEFAULT_PLACEMENT);

    expect(task.startCol).toBe(4);
    expect(task.endCol).toBe(5);
    expect(task.row).toBe(10);
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
