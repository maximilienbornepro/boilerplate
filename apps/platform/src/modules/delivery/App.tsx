import { useState, useEffect, useMemo, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { BoardDelivery } from './components/BoardDelivery';
import { BoardList } from './components/BoardList/BoardList';
import { RestoreModal } from './components/RestoreModal';
import { SnapshotModal } from './components/SnapshotModal';
import { ImportModal } from './components/ImportModal';
import { SanityCheckModal } from './components/SanityCheckModal/SanityCheckModal';
import { generateSprintsForBoard, type BoardConfig } from './utils/sprintGeneration';
import { Layout, ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import type { Board } from './services/api';
import { fetchBoard } from './services/api';
import {
  fetchTasksForBoard,
  createTask,
  updateTaskApi,
  nestTaskApi,
  unnestTaskApi,
  saveTaskPosition,
  fetchPositionsForBoard,
  fetchIncrementState,
  hideTask,
  restoreTasks,
  ensureDailySnapshot,
  fetchActiveConnectors,
  fetchJiraSiteUrl,
  fetchJiraVersions,
} from './services/api';
import type { ActiveConnector } from './services/api';
import type { Task, Release, IncrementState, HiddenTask } from './types';
import { transformTask, buildTaskTree } from './utils/taskTransform';
import { extractJiraKey } from './utils/jiraUtils';

// Containers always occupy 2 rows on the grid (fixed height)
const CONTAINER_ROW_SPAN = 2;
import { buildRowTracker } from './utils/taskLoading';
import './App.css';
import './index.css';

function BoardListPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();

  return (
    <Layout appId="delivery" variant="full-width" onNavigate={onNavigate}>
      <BoardList
        onSelect={(board) => navigate(`/delivery/${board.id}`)}
        onNavigate={onNavigate}
      />
    </Layout>
  );
}

function BoardDetailPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);

  useEffect(() => {
    if (!boardId) return;
    setLoadingBoard(true);
    fetchBoard(boardId)
      .then(setBoard)
      .catch(() => navigate('/delivery'))
      .finally(() => setLoadingBoard(false));
  }, [boardId]);

  if (loadingBoard || !board) {
    return (
      <Layout appId="delivery" variant="full-width" onNavigate={onNavigate}>
        <LoadingSpinner message="Chargement du board..." />
      </Layout>
    );
  }

  return (
    <BoardView
      board={board}
      onBack={() => navigate('/delivery')}
      onNavigate={onNavigate}
    />
  );
}

function App({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Routes>
      <Route path="/:boardId" element={<BoardDetailPage onNavigate={onNavigate} />} />
      <Route path="/" element={<BoardListPage onNavigate={onNavigate} />} />
    </Routes>
  );
}

function BoardView({ board, onBack, onNavigate }: { board: Board; onBack: () => void; onNavigate?: (path: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incrementState, setIncrementState] = useState<IncrementState | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSanityModal, setShowSanityModal] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<ActiveConnector[]>([]);
  const [jiraSiteUrl, setJiraSiteUrl] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  // Manual override: assigns a container to a specific project row.
  // Key = task id, value = project key. Takes priority over child-based detection.
  const [containerProjectMap, setContainerProjectMap] = useState<Record<string, string>>({});
  const [releases, setReleases] = useState<Release[]>([]);

  // Compute sprint structure from the board's config (replaces the old
  // hardcoded generateIncrements2026 function + the increment selector).
  const boardConfig: BoardConfig = useMemo(() => ({
    id: board.id,
    boardType: board.boardType ?? 'agile',
    startDate: board.startDate ?? '2026-01-19',
    endDate: board.endDate ?? '2026-03-02',
    durationWeeks: board.durationWeeks ?? 6,
  }), [board]);

  const { sprints: currentSprints, totalCols } = useMemo(
    () => generateSprintsForBoard(boardConfig),
    [boardConfig]
  );

  // Board-level state ID (used for freeze/hide/snapshot — scoped to the
  // board as a whole, not to individual sprints).
  const boardStateId = board.id;
  // Default sprint for new tasks (first sprint of the board).
  const defaultSprintId = currentSprints[0]?.id ?? `${board.id}_s1`;

  // Load active connectors + Jira site URL on mount
  useEffect(() => {
    const load = async () => {
      const [connectors, siteUrl] = await Promise.all([
        fetchActiveConnectors(),
        fetchJiraSiteUrl(),
      ]);
      if (siteUrl && !connectors.some(c => c.service === 'jira')) {
        connectors.push({ service: 'jira' });
      }
      setActiveConnectors(connectors);
      setJiraSiteUrl(siteUrl);
    };
    load();
  }, []);

  // Load board-level state (freeze, hidden tasks)
  const loadIncrementState = useCallback(async () => {
    try {
      const state = await fetchIncrementState(boardStateId);
      setIncrementState(state);
    } catch (err) {
      console.error('Failed to load board state:', err);
      setIncrementState({
        incrementId: boardStateId,
        isFrozen: false,
        hiddenTaskIds: [],
        hiddenTasks: [],
        frozenAt: null,
      });
    }
  }, [boardStateId]);

  useEffect(() => {
    loadIncrementState();
  }, [loadIncrementState]);

  // Auto-snapshot
  useEffect(() => {
    if (incrementState) {
      ensureDailySnapshot(boardStateId)
        .then(({ created }) => {
          if (created) console.log('Daily snapshot created for board', boardStateId);
        })
        .catch((err) => console.error('Failed to ensure daily snapshot:', err));
    }
  }, [incrementState, boardStateId]);

  // Reset state when board changes
  useEffect(() => {
    setTasks([]);
    setError(null);
    setIncrementState(null);
  }, [boardStateId]);

  // Load all tasks for the board (across all sprints)
  const loadTasks = useCallback(async () => {
    if (incrementState === null) return;

    setIsLoading(true);
    setError(null);

    try {
      const taskData = await fetchTasksForBoard(board.id);

      // Filter out hidden tasks
      const hiddenIds = new Set(incrementState.hiddenTaskIds || []);
      const visibleTasks = taskData.filter(t => !hiddenIds.has(t.id));

      // Load positions for the entire board
      let positions: { taskId: string; startCol: number; endCol: number; row: number; rowSpan?: number }[] = [];
      try {
        const posData = await fetchPositionsForBoard(board.id);
        positions = posData.map(p => ({
          taskId: p.taskId,
          startCol: p.startCol,
          endCol: p.endCol,
          row: p.row,
          rowSpan: p.rowSpan ?? 1,
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
  }, [board.id, incrementState]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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
      const result = await hideTask(boardStateId, taskId);
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
      const result = await restoreTasks(boardStateId, taskIds);
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
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const taskRow = task.row ?? 0;
    const taskRowSpan = task.rowSpan ?? 1;

    // Check if the new size would overlap another task on the same row
    const wouldOverlap = tasks.some(t => {
      if (t.id === taskId || t.parentTaskId) return false;
      const tStart = t.startCol ?? 0;
      const tEnd = t.endCol ?? (tStart + 1);
      const tRow = t.row ?? 0;
      const tRowSpan = t.rowSpan ?? 1;
      const colOverlap = newStartCol < tEnd && newEndCol > tStart;
      const rowOverlap = taskRow < (tRow + tRowSpan) && (taskRow + taskRowSpan) > tRow;
      return colOverlap && rowOverlap;
    });

    if (wouldOverlap) return; // Block the resize

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, startCol: newStartCol, endCol: newEndCol } : t
      )
    );

    try {
      await saveTaskPosition({
        taskId,
        incrementId: defaultSprintId,
        startCol: newStartCol,
        endCol: newEndCol,
        row: taskRow,
        rowSpan: taskRowSpan,
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
    const taskRowSpan = task.rowSpan ?? 1;

    // ── Collision check: find a free row if the target is occupied ──
    // Only check top-level tasks (not children nested inside containers).
    const otherTasks = tasks.filter(t =>
      t.id !== taskId && !t.parentTaskId
    );

    const isOccupied = (r: number): boolean => {
      return otherTasks.some(t => {
        const tStart = t.startCol ?? 0;
        const tEnd = t.endCol ?? (tStart + 1);
        const tRow = t.row ?? 0;
        const tRowSpan = t.rowSpan ?? 1;
        // Check column overlap
        const colOverlap = newStartCol < tEnd && newEndCol > tStart;
        // Check row overlap
        const rowOverlap = r < (tRow + tRowSpan) && (r + taskRowSpan) > tRow;
        return colOverlap && rowOverlap;
      });
    };

    let finalRow = newRow;
    // If the target position is occupied, find the next free row
    while (isOccupied(finalRow)) {
      finalRow++;
    }

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, startCol: newStartCol, endCol: newEndCol, row: finalRow } : t
      )
    );

    try {
      await saveTaskPosition({
        taskId,
        incrementId: defaultSprintId,
        startCol: newStartCol,
        endCol: newEndCol,
        row: finalRow,
        rowSpan: taskRowSpan,
      });
    } catch (err) {
      console.error('Failed to save position:', err);
    }
  };

  // Nest a Jira task inside a container task
  const handleNestTask = useCallback(async (childId: string, containerId: string) => {
    const container = tasks.find(t => t.id === containerId);
    if (!container) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === childId) return { ...t, parentTaskId: containerId };
        if (t.id === containerId) return { ...t, rowSpan: CONTAINER_ROW_SPAN };
        return t;
      })
    );

    try {
      await nestTaskApi(childId, containerId);
      await saveTaskPosition({
        taskId: containerId,
        incrementId: defaultSprintId,
        startCol: container.startCol ?? 0,
        endCol: container.endCol ?? 2,
        row: container.row ?? 0,
        rowSpan: CONTAINER_ROW_SPAN,
      });
    } catch (err) {
      console.error('Failed to nest task:', err);
      setTasks((prev) =>
        prev.map((t) => t.id === childId ? { ...t, parentTaskId: null } : t)
      );
    }
  }, [tasks, boardStateId]);

  // Unnest a child task from its container
  const handleUnnestTask = useCallback(async (childId: string) => {
    const child = tasks.find(t => t.id === childId);
    if (!child?.parentTaskId) return;

    const containerId = child.parentTaskId;
    const container = tasks.find(t => t.id === containerId);

    const maxEndRow = Math.max(0, ...tasks
      .filter(t => !t.parentTaskId)
      .map(t => (t.row ?? 0) + (t.rowSpan ?? 1))
    );

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === childId) return { ...t, parentTaskId: null, startCol: 0, endCol: 2, row: maxEndRow, rowSpan: 1 };
        if (t.id === containerId) return { ...t, rowSpan: CONTAINER_ROW_SPAN };
        return t;
      })
    );

    try {
      await unnestTaskApi(childId);
      await saveTaskPosition({ taskId: childId, incrementId: defaultSprintId, startCol: 0, endCol: 2, row: maxEndRow, rowSpan: 1 });
      if (container) {
        await saveTaskPosition({ taskId: containerId, incrementId: defaultSprintId, startCol: container.startCol ?? 0, endCol: container.endCol ?? 2, row: container.row ?? 0, rowSpan: CONTAINER_ROW_SPAN });
      }
    } catch (err) {
      console.error('Failed to unnest task:', err);
      loadTasks();
    }
  }, [tasks, boardStateId, loadTasks]);

  // Add new task (always manual = container)
  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    try {
      const taskData = await createTask({
        title: newTaskTitle.trim(),
        incrementId: defaultSprintId,
        type: 'feature',
        status: 'todo',
        source: 'manual',
      });

      const maxEndRow = Math.max(0, ...tasks.map(t => (t.row ?? 0) + (t.rowSpan ?? 1)));
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
        source: 'manual',
        parentTaskId: null,
        description: null,
        startCol: 0,
        endCol: 2,
        row: maxEndRow,
        rowSpan: CONTAINER_ROW_SPAN,
      };

      setTasks((prev) => [...prev, newTask]);

      await saveTaskPosition({
        taskId: newTask.id,
        incrementId: defaultSprintId,
        startCol: 0,
        endCol: 2,
        row: maxEndRow,
        rowSpan: CONTAINER_ROW_SPAN,
      });

      setNewTaskTitle('');
      setShowAddTask(false);
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  // Extract distinct Jira project keys from task titles for the project filter.
  const jiraProjects = useMemo(() => {
    const projects = new Set<string>();
    for (const task of tasks) {
      const key = extractJiraKey(task.title);
      if (key) {
        const project = key.split('-')[0];
        projects.add(project);
      }
    }
    return Array.from(projects).sort();
  }, [tasks]);

  // Per-project colors for release markers
  const PROJECT_MARKER_COLORS: Record<string, string> = {
    TVSMART: '#3b82f6', TVFREE: '#1f2937', TVORA: '#f97316',
    TVSFR: '#dc2626', TVFIRE: '#eab308', PLAYERW: '#8b5cf6',
    ROADMAP_SFR: '#ec4899', TVAPI: '#06b6d4', TVAPPS: '#14b8a6',
  };

  // Fetch Jira releases when projects are detected and board has dates
  useEffect(() => {
    if (jiraProjects.length === 0 || !boardConfig.startDate || !boardConfig.endDate) {
      setReleases([]);
      return;
    }
    fetchJiraVersions(jiraProjects, boardConfig.startDate, boardConfig.endDate)
      .then(versions => {
        setReleases(versions.map(v => ({
          id: v.id,
          date: v.date,
          version: v.version,
          projectKey: v.projectKey,
          color: PROJECT_MARKER_COLORS[v.projectKey] || '#6b7280',
        })));
      })
      .catch(() => setReleases([]));
  }, [jiraProjects, boardConfig.startDate, boardConfig.endDate]);

  // Filter tasks by selected project (null = show all).
  const filteredTasks = useMemo(() => {
    if (!selectedProject) return tasks;
    return tasks.filter(task => {
      // Manual tasks (containers) → always show if they have children matching
      if (task.source === 'manual') {
        // Show container if any of its children belong to this project
        const hasMatchingChild = tasks.some(
          t => t.parentTaskId === task.id && extractJiraKey(t.title)?.startsWith(selectedProject + '-')
        );
        return hasMatchingChild;
      }
      const key = extractJiraKey(task.title);
      return key ? key.startsWith(selectedProject + '-') : false;
    });
  }, [tasks, selectedProject]);

  // Build task tree (containers with children embedded) for rendering
  const displayTasks = useMemo(() => buildTaskTree(filteredTasks), [filteredTasks]);

  const hiddenTaskCount = incrementState?.hiddenTasks?.length || 0;

  return (
    <Layout appId="delivery" variant="full-width" onNavigate={onNavigate}>
      <div className="scope-delivery">
        <div className="app">
          <ModuleHeader
            title={board.name}
            onBack={onBack}
          >
            {jiraProjects.length >= 2 && (
              <select
                className="module-header-btn"
                value={selectedProject ?? ''}
                onChange={(e) => setSelectedProject(e.target.value || null)}
              >
                <option value="">Tous les projets</option>
                {jiraProjects.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}

            {activeConnectors.length > 0 && (
              <button
                className="module-header-btn"
                onClick={() => setShowImportModal(true)}
              >
                Importer taches
              </button>
            )}

            {tasks.some(t => t.source && t.source !== 'manual') && (
              <button
                className="module-header-btn"
                onClick={() => setShowSanityModal(true)}
                title="Analyser le board avec l'IA et proposer des repositionnements (Jira, ClickUp, Linear, Asana…)"
              >
                ✨ Vérifier avec l'IA
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
                placeholder="Titre de la nouvelle tâche..."
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
            <LoadingSpinner size="lg" message="Chargement des tâches..." fullPage />
          ) : (
            <div className="main-content">
              <div className="board-section">
                <BoardDelivery
                  sprints={currentSprints}
                  tasks={displayTasks}
                  releases={releases}
                  boardLabel={board.name}
                  readOnly={false}
                  totalCols={totalCols}
                  jiraBaseUrl={jiraSiteUrl}
                  containerProjectMap={containerProjectMap}
                  availableProjects={jiraProjects}
                  onContainerProjectChange={(taskId, project) =>
                    setContainerProjectMap(prev => ({ ...prev, [taskId]: project }))
                  }
                  onTaskUpdate={handleTaskUpdate}
                  onTaskDelete={handleTaskDelete}
                  onTaskResize={handleTaskResize}
                  onTaskMove={handleTaskMove}
                  onNestTask={handleNestTask}
                  onUnnestTask={handleUnnestTask}
                  onAddTask={() => setShowAddTask(true)}
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
              incrementId={boardStateId}
              onRestore={async () => {
                await loadTasks();
                await loadIncrementState();
              }}
              onClose={() => setShowSnapshotModal(false)}
            />
          )}

          {showImportModal && (
            <ImportModal
              incrementId={defaultSprintId}
              activeConnectors={activeConnectors}
              onImported={loadTasks}
              onClose={() => setShowImportModal(false)}
            />
          )}

          {showSanityModal && (
            <SanityCheckModal
              boardId={board.id}
              onClose={() => setShowSanityModal(false)}
              onApplied={() => { setShowSanityModal(false); loadTasks(); }}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default App;
