import { useState, useEffect, useMemo, useCallback } from 'react';
import { BoardDelivery } from './components/BoardDelivery';
import { RestoreModal } from './components/RestoreModal';
import { SnapshotModal } from './components/SnapshotModal';
import { JiraImportModal } from './components/JiraImportModal';
import { generateIncrements2026 } from './components/BurgerMenu';
import { Layout, ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import {
  fetchTasks,
  createTask,
  updateTaskApi,
  deleteTaskApi,
  saveTaskPosition,
  getTaskPositions,
  fetchIncrementState,
  toggleFreeze,
  hideTask,
  restoreTasks,
  ensureDailySnapshot,
  checkJiraConnected,
} from './services/api';
import type { Task, IncrementState, HiddenTask } from './types';
import { transformTask } from './utils/taskTransform';
import { buildRowTracker } from './utils/taskLoading';
import './App.css';
import './index.css';

function App({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIncrement, setSelectedIncrement] = useState('inc1');
  const [incrementState, setIncrementState] = useState<IncrementState | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [showJiraImport, setShowJiraImport] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const incrementList = useMemo(() => generateIncrements2026(), []);

  const currentIncrementName = useMemo(() => {
    const inc = incrementList.find((i) => i.id === selectedIncrement);
    return inc?.name || selectedIncrement;
  }, [incrementList, selectedIncrement]);

  const currentSprints = useMemo(() => {
    const inc = incrementList.find((i) => i.id === selectedIncrement);
    return inc?.sprints || [];
  }, [incrementList, selectedIncrement]);

  // Check Jira connection on mount
  useEffect(() => {
    checkJiraConnected().then(setJiraConnected);
  }, []);

  // Load increment state
  const loadIncrementState = useCallback(async () => {
    try {
      const state = await fetchIncrementState(selectedIncrement);
      setIncrementState(state);
    } catch (err) {
      console.error('Failed to load increment state:', err);
      setIncrementState({
        incrementId: selectedIncrement,
        isFrozen: false,
        hiddenTaskIds: [],
        hiddenTasks: [],
        frozenAt: null,
      });
    }
  }, [selectedIncrement]);

  useEffect(() => {
    loadIncrementState();
  }, [loadIncrementState]);

  // Auto-snapshot
  useEffect(() => {
    if (incrementState) {
      ensureDailySnapshot(selectedIncrement)
        .then(({ created }) => {
          if (created) console.log('Daily snapshot created for', selectedIncrement);
        })
        .catch((err) => console.error('Failed to ensure daily snapshot:', err));
    }
  }, [incrementState, selectedIncrement]);

  // Reset state when increment changes
  useEffect(() => {
    setTasks([]);
    setError(null);
    setIncrementState(null);
  }, [selectedIncrement]);

  // Load tasks
  const loadTasks = useCallback(async () => {
    if (incrementState === null) return;

    setIsLoading(true);
    setError(null);

    try {
      const taskData = await fetchTasks(selectedIncrement);

      // Filter out hidden tasks
      const hiddenIds = new Set(incrementState.hiddenTaskIds || []);
      const visibleTasks = taskData.filter(t => !hiddenIds.has(t.id));

      // Load positions
      let positions: { taskId: string; startCol: number; endCol: number; row: number }[] = [];
      try {
        const posData = await getTaskPositions(selectedIncrement);
        positions = posData.map(p => ({
          taskId: p.taskId,
          startCol: p.startCol,
          endCol: p.endCol,
          row: p.row,
        }));
      } catch {
        // Ignore position errors
      }

      const positionMap = new Map(positions.map(p => [p.taskId, p]));
      const newTaskRowByCol = buildRowTracker(positions);

      const transformedTasks: Task[] = visibleTasks.map((taskData) => {
        const savedPosition = positionMap.get(taskData.id);
        const defaultCol = 0;
        const defaultRow = newTaskRowByCol[defaultCol] || 0;
        if (!savedPosition) {
          if (defaultCol in newTaskRowByCol) newTaskRowByCol[defaultCol]++;
        }
        return transformTask(taskData, savedPosition, { startCol: defaultCol, endCol: defaultCol + 2, row: defaultRow });
      });

      setTasks(transformedTasks);
    } catch (err) {
      setError((err as Error).message);
      console.error('Failed to load tasks:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedIncrement, incrementState]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Handle freeze toggle
  const handleToggleFreeze = useCallback(async () => {
    try {
      const newState = await toggleFreeze(selectedIncrement);
      setIncrementState(newState);
    } catch (err) {
      console.error('Failed to toggle freeze:', err);
    }
  }, [selectedIncrement]);

  // Task handlers
  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((task) => task.id === taskId ? { ...task, ...updates } : task)
    );
    try {
      await updateTaskApi(taskId, updates as Record<string, unknown>);
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      const result = await hideTask(selectedIncrement, taskId);
      setIncrementState((prev) =>
        prev ? {
          ...prev,
          hiddenTasks: result.hiddenTasks,
          hiddenTaskIds: result.hiddenTasks.map((t: HiddenTask) => t.taskId),
        } : prev
      );
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      console.error('Failed to hide task:', err);
    }
  };

  const handleRestoreTasks = async (taskIds: string[]) => {
    try {
      const result = await restoreTasks(selectedIncrement, taskIds);
      setIncrementState((prev) =>
        prev ? {
          ...prev,
          hiddenTasks: result.hiddenTasks,
          hiddenTaskIds: result.hiddenTasks.map((t: HiddenTask) => t.taskId),
        } : prev
      );
      setShowRestoreModal(false);
      loadTasks();
    } catch (err) {
      console.error('Failed to restore tasks:', err);
    }
  };

  const handleTaskResize = async (taskId: string, newStartCol: number, newEndCol: number) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, startCol: newStartCol, endCol: newEndCol } : task
      )
    );

    try {
      const task = tasks.find((t) => t.id === taskId);
      await saveTaskPosition({
        taskId,
        incrementId: selectedIncrement,
        startCol: newStartCol,
        endCol: newEndCol,
        row: task?.row ?? 0,
      });
    } catch (err) {
      console.error('Failed to save position:', err);
    }
  };

  const handleTaskMove = async (taskId: string, newStartCol: number, newRow: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const taskWidth = (task.endCol ?? 1) - (task.startCol ?? 0);
    const newEndCol = newStartCol + taskWidth;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, startCol: newStartCol, endCol: newEndCol, row: newRow } : t
      )
    );

    try {
      await saveTaskPosition({
        taskId,
        incrementId: selectedIncrement,
        startCol: newStartCol,
        endCol: newEndCol,
        row: newRow,
      });
    } catch (err) {
      console.error('Failed to save position:', err);
    }
  };

  // Add new task
  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    try {
      const taskData = await createTask({
        title: newTaskTitle.trim(),
        incrementId: selectedIncrement,
        type: 'feature',
        status: 'todo',
      });

      const maxRow = Math.max(0, ...tasks.map(t => t.row ?? 0));
      const newTask: Task = {
        id: taskData.id,
        title: taskData.title,
        type: (taskData.type as Task['type']) || 'feature',
        status: (taskData.status as Task['status']) || 'todo',
        storyPoints: taskData.storyPoints ?? undefined,
        estimatedDays: taskData.estimatedDays,
        assignee: taskData.assignee,
        priority: taskData.priority,
        incrementId: taskData.incrementId ?? undefined,
        sprintName: taskData.sprintName,
        startCol: 0,
        endCol: 2,
        row: maxRow + 1,
      };

      setTasks((prev) => [...prev, newTask]);

      await saveTaskPosition({
        taskId: newTask.id,
        incrementId: selectedIncrement,
        startCol: 0,
        endCol: 2,
        row: maxRow + 1,
      });

      setNewTaskTitle('');
      setShowAddTask(false);
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  const hiddenTaskCount = incrementState?.hiddenTasks?.length || 0;

  return (
    <Layout appId="delivery" variant="full-width" onNavigate={onNavigate}>
      <div className="scope-delivery">
        <div className="app">
          <ModuleHeader
            title="Delivery Board"
            onBack={() => onNavigate?.('/')}
          >
            <select
              className="module-header-btn increment-select"
              value={selectedIncrement}
              onChange={(e) => setSelectedIncrement(e.target.value)}
            >
              {incrementList.map((inc) => (
                <option key={inc.id} value={inc.id}>
                  {inc.name}
                </option>
              ))}
            </select>

            <button
              className={`module-header-btn freeze-btn ${incrementState?.isFrozen ? 'frozen' : ''}`}
              onClick={handleToggleFreeze}
              title={incrementState?.isFrozen ? 'Defiger l\'increment' : 'Figer l\'increment'}
            >
              {incrementState?.isFrozen ? 'Defiger' : 'Figer'}
            </button>

            {jiraConnected && (
              <button
                className="module-header-btn"
                onClick={() => setShowJiraImport(true)}
              >
                Importer depuis Jira
              </button>
            )}

            <button
              className="module-header-btn"
              onClick={() => setShowAddTask(!showAddTask)}
            >
              + Tache
            </button>

            <button
              className="module-header-btn"
              onClick={() => setShowSnapshotModal(true)}
            >
              Historique
            </button>

            {hiddenTaskCount > 0 && (
              <button
                className="module-header-btn"
                onClick={() => setShowRestoreModal(true)}
              >
                Restaurer ({hiddenTaskCount})
              </button>
            )}
          </ModuleHeader>

          {/* Add task form */}
          {showAddTask && (
            <div className="toolbar">
              <input
                type="text"
                className="add-task-input"
                placeholder="Titre de la nouvelle tache..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                autoFocus
              />
              <button className="add-task-btn" onClick={handleAddTask}>
                Ajouter
              </button>
              <button className="add-task-cancel" onClick={() => { setShowAddTask(false); setNewTaskTitle(''); }}>
                Annuler
              </button>
            </div>
          )}

          {error && (
            <div className="toolbar">
              <span className="error-msg">{error}</span>
            </div>
          )}

          {isLoading && tasks.length === 0 ? (
            <LoadingSpinner size="lg" message="Chargement des taches..." fullPage />
          ) : (
            <div className="main-content">
              <div className="board-section">
                <BoardDelivery
                  sprints={currentSprints}
                  tasks={tasks}
                  releases={[]}
                  boardLabel={currentIncrementName}
                  readOnly={incrementState?.isFrozen}
                  onTaskUpdate={handleTaskUpdate}
                  onTaskDelete={handleTaskDelete}
                  onTaskResize={handleTaskResize}
                  onTaskMove={handleTaskMove}
                />
              </div>
            </div>
          )}

          {/* Modals */}
          {showRestoreModal && incrementState && (
            <RestoreModal
              hiddenTasks={incrementState.hiddenTasks}
              onRestore={handleRestoreTasks}
              onClose={() => setShowRestoreModal(false)}
            />
          )}

          {showSnapshotModal && (
            <SnapshotModal
              incrementId={selectedIncrement}
              onRestore={async () => {
                await loadTasks();
                await loadIncrementState();
              }}
              onClose={() => setShowSnapshotModal(false)}
            />
          )}

          {showJiraImport && (
            <JiraImportModal
              incrementId={selectedIncrement}
              onImported={loadTasks}
              onClose={() => setShowJiraImport(false)}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default App;
