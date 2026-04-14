import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { Layout, LoadingSpinner, ModuleHeader, ConfirmModal } from '@boilerplate/shared/components';
import type { Planning, Task, Dependency, ViewMode, Marker, PlanningFormData, DeliveryOverlayTask } from './types';
import * as api from './services/api';
import { getNextColor } from './utils/taskUtils';
import { buildEnhancedTasks } from './utils/deliveryVirtualRow';
import { PlanningList } from './components/PlanningList/PlanningList';
import { PlanningForm } from './components/PlanningList/PlanningForm';
import { GanttBoard, type GanttBoardHandle } from './components/GanttBoard/GanttBoard';
import { TaskForm } from './components/TaskForm/TaskForm';
import { ViewSelector } from './components/ViewSelector/ViewSelector';
import { SubjectsPanel } from './components/SubjectsPanel/SubjectsPanel';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';
import './index.css';

function getUrlPlanningId(): string | null {
  return new URLSearchParams(window.location.search).get('id');
}

function getEmbedPlanningId(): string | null {
  return new URLSearchParams(window.location.search).get('embed');
}

export default function RoadmapApp({ onNavigate, embedMode, embedId }: { onNavigate?: (path: string) => void; embedMode?: boolean; embedId?: string }) {
  const embedPlanningId = getEmbedPlanningId() || (embedMode ? embedId : null);

  if (embedPlanningId) {
    return <EmbedView planningId={embedPlanningId} />;
  }

  return (
    <Routes>
      <Route path="/:planningId" element={
        <Layout appId="roadmap" variant="full-width" onNavigate={onNavigate}>
          <PlanningDetailView onNavigate={onNavigate} />
        </Layout>
      } />
      <Route path="/" element={
        <Layout appId="roadmap" variant="full-width" onNavigate={onNavigate}>
          <PlanningListView onNavigate={onNavigate} />
        </Layout>
      } />
    </Routes>
  );
}

// ==================== EMBED VIEW ====================

function EmbedView({ planningId }: { planningId: string }) {
  const [planning, setPlanning] = useState<Planning | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ganttEmbedRef = useRef<GanttBoardHandle | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [p, t, d, m] = await Promise.all([
          api.fetchPlanningEmbed(planningId),
          api.fetchTasksEmbed(planningId),
          api.fetchDependenciesEmbed(planningId),
          api.fetchMarkersEmbed(planningId),
        ]);
        setPlanning(p); setTasks(t); setDependencies(d); setMarkers(m);
      } catch { setError('Erreur lors du chargement du planning'); }
      finally { setLoading(false); }
    };
    load();
  }, [planningId]);

  // Scroll to today once GanttBoard is mounted and data is loaded
  useEffect(() => {
    if (!loading && planning) {
      setTimeout(() => ganttEmbedRef.current?.scrollToToday(), 150);
    }
  }, [loading, planning]);

  const noop = useCallback(() => {}, []);
  const noopTask = useCallback((_id: string, _u: Partial<Task>) => {}, []);
  const noopClick = useCallback((_t: Task) => {}, []);
  const noopStr = useCallback((_id: string) => {}, []);
  const noopDep = useCallback((_f: string, _t: string) => {}, []);

  if (loading) return <div className="roadmap-loading"><LoadingSpinner message="Chargement..." /></div>;
  if (error || !planning) return <div className="roadmap-loading">{error || 'Planning non trouve'}</div>;

  return (
    <div className="roadmap-embed">
      <div className="roadmap-embed-header">
        <h1 className="roadmap-embed-title">{planning.name}</h1>
        <ViewSelector viewMode={viewMode} onViewModeChange={setViewMode} />
      </div>
      <div className="roadmap-gantt-container">
        <GanttBoard
          ref={ganttEmbedRef}
          planning={planning} tasks={tasks} dependencies={dependencies} viewMode={viewMode} markers={markers}
          onTaskUpdate={noopTask} onTaskClick={noopClick} onTaskDelete={noopStr}
          onAddTask={noop} onAddChildTask={noopStr} onCreateDependency={noopDep} onDeleteDependency={noopStr}
          readOnly autoHeight
        />
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================

function PlanningListView({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  const [plannings, setPlannings] = useState<Planning[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlanningForm, setShowPlanningForm] = useState(false);
  const [editingPlanningForForm, setEditingPlanningForForm] = useState<Planning | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Planning | null>(null);

  // Auto-open create modal if URL has ?create=1 (from Dashboard)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      setShowPlanningForm(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('create');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    api.fetchPlannings()
      .then(setPlannings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreatePlanningFromForm = async (data: PlanningFormData): Promise<Planning | null> => {
    try {
      const planning = await api.createPlanning(data);
      // Note: navigation is deferred until the form has linked its delivery
      // boards (see <PlanningForm onSubmit={...}> below). We just return
      // the created planning so the form can orchestrate the linking step.
      return planning;
    } catch {
      return null;
    }
  };

  const handleEditPlanningFromForm = async (id: string, data: PlanningFormData): Promise<Planning | null> => {
    try {
      const updated = await api.updatePlanning(id, data);
      setPlannings(prev => prev.map(p => p.id === id ? updated : p));
      return updated;
    } catch {
      return null;
    }
  };

  const handleDeletePlanning = async () => {
    if (!confirmDelete) return;
    try {
      await api.deletePlanning(confirmDelete.id);
      setPlannings(prev => prev.filter(p => p.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {}
  };

  if (loading && plannings.length === 0) {
    return <LoadingSpinner message="Chargement..." />;
  }

  return (
    <>
      <ModuleHeader title="Roadmap">
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => { setEditingPlanningForForm(null); setShowPlanningForm(true); }}
        >
          + Nouvelle roadmap
        </button>
      </ModuleHeader>
      <PlanningList
        plannings={plannings}
        activePlanningId={null}
        onSelect={(p) => navigate(`/roadmap/${p.id}`)}
        onEdit={(p) => { setEditingPlanningForForm(p); setShowPlanningForm(true); }}
        onDelete={(id) => { const p = plannings.find(pl => pl.id === id); if (p) setConfirmDelete(p); }}
        onAdd={() => { setEditingPlanningForForm(null); setShowPlanningForm(true); }}
      />
      {showPlanningForm && (
        <PlanningForm
          planning={editingPlanningForForm}
          onSubmit={async (data) => {
            if (editingPlanningForForm) {
              return handleEditPlanningFromForm(editingPlanningForForm.id, data);
            }
            const created = await handleCreatePlanningFromForm(data);
            // Navigate only AFTER the form has finished its linking step
            // (it will call onClose after linking, which triggers cleanup).
            if (created) {
              // Delay navigation until after the form's syncBoardLinks() call
              // resolves. The form awaits onSubmit, then syncBoardLinks, then
              // onClose — we use a microtask queue here via setTimeout(0).
              setTimeout(() => navigate(`/roadmap/${created.id}`), 0);
            }
            return created;
          }}
          onClose={() => { setShowPlanningForm(false); setEditingPlanningForForm(null); }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Supprimer le planning"
          message={`Êtes-vous sûr de vouloir supprimer "${confirmDelete.name}" ? Toutes les tâches et dépendances seront supprimées.`}
          onConfirm={handleDeletePlanning}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel="Supprimer"
          danger
        />
      )}
    </>
  );
}

function PlanningDetailView({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { planningId } = useParams<{ planningId: string }>();
  const navigate = useNavigate();
  const [selectedPlanning, setSelectedPlanning] = useState<Planning | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [deliveryOverlay, setDeliveryOverlay] = useState<DeliveryOverlayTask[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [yearOffset, setYearOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showPlanningForm, setShowPlanningForm] = useState(false);
  const [editingPlanningForForm, setEditingPlanningForForm] = useState<Planning | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showSubjectsPanel, setShowSubjectsPanel] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const ganttScrollRef = useRef<GanttBoardHandle | null>(null);
  const platformSettings = usePlatformSettings();
  const integrationEnabled = platformSettings['integration_roadmap_suivitess'] ?? false;

  useEffect(() => {
    if (!planningId) return;
    // Load the planning details
    api.fetchPlannings().then(plannings => {
      const found = plannings.find(p => p.id === planningId);
      if (found) {
        setSelectedPlanning(found);
      } else {
        navigate('/roadmap');
      }
    }).catch(() => navigate('/roadmap'))
    .finally(() => setLoading(false));
  }, [planningId]);

  useEffect(() => {
    if (selectedPlanning) loadPlanningData(selectedPlanning.id);
  }, [selectedPlanning]);

  const loadPlanningData = async (planningId: string) => {
    try {
      setLoading(true);
      const [t, d, m, overlay] = await Promise.all([
        api.fetchTasks(planningId),
        api.fetchDependencies(planningId),
        api.fetchMarkers(planningId),
        api.fetchDeliveryOverlay(planningId).catch(() => [] as DeliveryOverlayTask[]),
      ]);
      setTasks(t); setDependencies(d); setMarkers(m); setDeliveryOverlay(overlay);
    } catch { setError('Erreur lors du chargement des données'); }
    finally { setLoading(false); }
  };

  /**
   * Tasks fed to GanttBoard — real roadmap tasks with an optional virtual
   * "Delivery" parent row prepended when a delivery overlay exists.
   * Memoized so we don't rebuild the array on every render.
   */
  const enhancedTasks = useMemo(
    () => buildEnhancedTasks(tasks, deliveryOverlay),
    [tasks, deliveryOverlay]
  );

  // Planning handlers
  const handleCreatePlanning = async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 13, 0);
    try {
      const planning = await api.createPlanning({
        name: 'Nouveau planning',
        description: '',
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      });
      setPlannings(prev => [planning, ...prev]);
      setSelectedPlanning(planning);
    } catch { setError('Erreur lors de la création du planning'); }
  };

  const handleCreatePlanningFromForm = async (data: PlanningFormData) => {
    try {
      const planning = await api.createPlanning(data);
      setPlannings(prev => [planning, ...prev]);
      setSelectedPlanning(planning);
    } catch { setError('Erreur lors de la création du planning'); }
  };

  const handleEditPlanning = async (id: string, data: Partial<Planning>) => {
    try {
      const updated = await api.updatePlanning(id, data);
      setPlannings(prev => prev.map(p => p.id === id ? updated : p));
      if (selectedPlanning?.id === id) setSelectedPlanning(updated);
    } catch { setError('Erreur lors de la modification du planning'); }
  };

  const handleDeletePlanning = async (id: string) => {
    try {
      await api.deletePlanning(id);
      setPlannings(prev => prev.filter(p => p.id !== id));
      if (selectedPlanning?.id === id) { setSelectedPlanning(null); setTasks([]); setDependencies([]); setMarkers([]); }
    } catch { setError('Erreur lors de la suppression du planning'); }
  };

  // Task handlers
  const handleAddTask = () => { setEditingTask(null); setShowTaskForm(true); };
  const handleTaskClick = useCallback((task: Task) => {
    // Virtual delivery rows are read-only — don't open the subjects panel.
    if (task.isVirtual) return;
    setSelectedTask(task);
    setShowSubjectsPanel(true);
    // Close any open TaskForm if switching tasks
    setShowTaskForm(false);
    setEditingTask(null);
  }, []);

  const handleTaskFormSubmit = async (data: { name: string; color: string; parentId?: string | null }) => {
    if (!selectedPlanning) return;
    try {
      if (editingTask) {
        const updated = await api.updateTask(editingTask.id, data);
        setTasks(prev => prev.map(t => t.id === editingTask.id ? updated : t));
        // Color cascade to descendants
        if (data.color !== editingTask.color) {
          const getDescIds = (parentId: string): string[] => {
            const children = tasks.filter(t => t.parentId === parentId);
            return children.flatMap(c => [c.id, ...getDescIds(c.id)]);
          };
          const descIds = getDescIds(editingTask.id);
          if (descIds.length > 0) {
            setTasks(prev => prev.map(t => descIds.includes(t.id) ? { ...t, color: data.color } : t));
            descIds.forEach(id => { api.updateTask(id, { color: data.color }).catch(() => {}); });
          }
        }
      } else {
        // Default dates: today + 5 business days
        const today = new Date();
        const startDate = today.toISOString().split('T')[0];
        const end = new Date(today); end.setDate(end.getDate() + 4);
        const endDate = end.toISOString().split('T')[0];
        // Auto-assign color: root tasks get the next unused color, children inherit parent color
        let autoColor: string;
        if (data.parentId) {
          const parentTask = tasks.find(t => t.id === data.parentId);
          autoColor = parentTask?.color ?? getNextColor(tasks.filter(t => !t.parentId).map(t => t.color));
        } else {
          autoColor = getNextColor(tasks.filter(t => !t.parentId).map(t => t.color));
        }
        const task = await api.createTask({
          planningId: selectedPlanning.id,
          name: data.name,
          color: autoColor,
          parentId: data.parentId || null,
          description: '',
          startDate,
          endDate,
          progress: 0,
        });
        setTasks(prev => [...prev, task]);
      }
      setShowTaskForm(false); setEditingTask(null);
    } catch { setError("Erreur lors de l'enregistrement de la tâche"); }
  };

  const handleTaskDelete = async () => {
    if (!editingTask) return;
    try {
      await api.deleteTask(editingTask.id);
      setTasks(prev => prev.filter(t => t.id !== editingTask.id));
      setShowTaskForm(false); setEditingTask(null);
    } catch { setError('Erreur lors de la suppression de la tâche'); }
  };

  const handleTaskDeleteDirect = useCallback(async (taskId: string) => {
    // Guard against virtual delivery rows — they have no DB row.
    if (taskId.startsWith('__virtual_')) return;
    try {
      await api.deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId && t.parentId !== taskId));
    } catch { setError('Erreur lors de la suppression de la tâche'); }
  }, []);

  const handleAddChildTask = useCallback(async (parentId: string) => {
    if (!selectedPlanning) return;
    // Cannot add real children under a virtual parent.
    if (parentId.startsWith('__virtual_')) return;
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const end = new Date(today); end.setDate(end.getDate() + 4);
    const endDate = end.toISOString().split('T')[0];
    const parentTask = tasks.find(t => t.id === parentId);
    const color = parentTask?.color || getNextColor(tasks.map(t => t.color));
    const existingChildren = tasks.filter(t => t.parentId === parentId);
    const name = `Sous-tâche ${existingChildren.length + 1}`;
    try {
      const task = await api.createTask({ planningId: selectedPlanning.id, parentId, name, startDate, endDate, color, description: '', progress: 0 });
      setTasks(prev => [...prev, task]);
    } catch { setError('Erreur lors de la création de la sous-tâche'); }
  }, [selectedPlanning, tasks]);

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    // Virtual tasks are not persisted — silently ignore any update attempt.
    if (taskId.startsWith('__virtual_')) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    try { await api.updateTask(taskId, updates); }
    catch { setError('Erreur lors de la mise à jour'); if (selectedPlanning) loadPlanningData(selectedPlanning.id); }
  }, [selectedPlanning]);

  // Dependency handlers
  const handleCreateDependency = useCallback(async (fromTaskId: string, toTaskId: string) => {
    // Dependencies cannot involve virtual delivery rows.
    if (fromTaskId.startsWith('__virtual_') || toTaskId.startsWith('__virtual_')) return;
    try {
      const dep = await api.createDependency(fromTaskId, toTaskId);
      setDependencies(prev => [...prev, dep]);
    } catch { setError('Erreur lors de la création de la dépendance'); }
  }, []);

  const handleDeleteDependency = useCallback(async (depId: string) => {
    try {
      await api.deleteDependency(depId);
      setDependencies(prev => prev.filter(d => d.id !== depId));
    } catch { setError('Erreur lors de la suppression de la dépendance'); }
  }, []);

  // Marker handlers
  const handleCreateMarker = useCallback(async () => {
    if (!selectedPlanning) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const marker = await api.createMarker(selectedPlanning.id, 'Marqueur', today);
      setMarkers(prev => [...prev, marker]);
    } catch { setError('Erreur lors de la création du marqueur'); }
  }, [selectedPlanning]);

  const handleUpdateMarker = useCallback(async (markerId: string, data: Partial<{ name: string; markerDate: string; color: string; taskId: string | null }>) => {
    // If a task is being linked, inherit its color
    let updatedData = { ...data };
    if ('taskId' in data && data.taskId !== null && data.taskId !== undefined) {
      const linkedTask = tasks.find(t => t.id === data.taskId);
      if (linkedTask) updatedData = { ...updatedData, color: linkedTask.color };
    }
    setMarkers(prev => prev.map(m => m.id === markerId ? { ...m, ...updatedData } : m));
    try { await api.updateMarker(markerId, updatedData); }
    catch { setError('Erreur lors de la mise a jour du marqueur'); if (selectedPlanning) api.fetchMarkers(selectedPlanning.id).then(setMarkers).catch(() => {}); }
  }, [selectedPlanning, tasks]);

  const handleDeleteMarker = useCallback(async (markerId: string) => {
    setMarkers(prev => prev.filter(m => m.id !== markerId));
    try { await api.deleteMarker(markerId); }
    catch { setError('Erreur lors de la suppression du marqueur'); }
  }, []);

  const handleCopyPreviewLink = useCallback(async () => {
    if (!selectedPlanning) return;
    const url = `${window.location.origin}${window.location.pathname}?embed=${selectedPlanning.id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* fallback */ }
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 2000);
  }, [selectedPlanning]);

  const handleTodayClick = useCallback(() => {
    setYearOffset(0);
    ganttScrollRef.current?.scrollToToday();
  }, []);

  const handleNavigateHome = useCallback(() => {
    if (onNavigate) onNavigate('/'); else window.location.href = '/';
  }, [onNavigate]);

  if (loading || !selectedPlanning) {
    return <LoadingSpinner message="Chargement..." />;
  }

  return (
    <>
      {error && (
        <div className="roadmap-error-banner">
          {error}
          <button onClick={() => setError(null)}>Fermer</button>
        </div>
      )}

      <ModuleHeader title={selectedPlanning.name} onBack={() => navigate('/roadmap')}>
        <ViewSelector
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          yearOffset={yearOffset}
          onYearOffsetChange={setYearOffset}
          currentYear={new Date(selectedPlanning.startDate).getFullYear() + yearOffset}
          onToday={handleTodayClick}
          yearNavDisabled={new Date(selectedPlanning.startDate).getFullYear() === new Date(selectedPlanning.endDate).getFullYear()}
        />
        <button
          type="button"
          className={`roadmap-share-btn${copiedPreview ? ' roadmap-share-btn--copied' : ''}`}
          onClick={handleCopyPreviewLink}
          title={copiedPreview ? 'Lien copié !' : 'Copier le lien de partage'}
          aria-label="Partager"
        >
          {copiedPreview ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="module-header-btn module-header-btn-primary roadmap-add-btn"
          onClick={handleAddTask}
        >
          + Tâche
        </button>
        <button
          type="button"
          className="module-header-btn module-header-btn-primary roadmap-add-btn"
          onClick={handleCreateMarker}
        >
          + Marqueur
        </button>
      </ModuleHeader>

      <div className={`roadmap-planning-view ${showSubjectsPanel && selectedTask ? 'roadmap-with-panel' : ''}`}>
        <div className="roadmap-gantt-container">
          <GanttBoard
            ref={ganttScrollRef}
            planning={yearOffset !== 0 ? {
              ...selectedPlanning,
              startDate: `${new Date(selectedPlanning.startDate).getFullYear() + yearOffset}-${selectedPlanning.startDate.slice(5)}`,
              endDate: `${new Date(selectedPlanning.endDate).getFullYear() + yearOffset}-${selectedPlanning.endDate.slice(5)}`,
            } : selectedPlanning}
            tasks={enhancedTasks}
            dependencies={dependencies}
            viewMode={viewMode}
            markers={markers}
            onTaskUpdate={handleTaskUpdate}
            onTaskClick={handleTaskClick}
            onTaskDelete={handleTaskDeleteDirect}
            onAddTask={handleAddTask}
            onAddChildTask={handleAddChildTask}
            onCreateDependency={handleCreateDependency}
            onDeleteDependency={handleDeleteDependency}
            onMarkerUpdate={handleUpdateMarker}
            onMarkerDelete={handleDeleteMarker}
            onAddMarker={handleCreateMarker}
          />
        </div>

        {showSubjectsPanel && selectedTask && (
          <SubjectsPanel
            task={selectedTask}
            planningId={selectedPlanning?.id}
            onClose={() => setShowSubjectsPanel(false)}
            onTaskUpdate={handleTaskUpdate}
            onTaskDelete={handleTaskDeleteDirect}
            onNavigateToSuiviTess={onNavigate ? (docId, sectionId) => onNavigate(`/suivitess/${docId}${sectionId ? `?section=${sectionId}` : ''}`) : undefined}
          />
        )}

        {showTaskForm && !editingTask && (
          <TaskForm
            task={null}
            planningId={selectedPlanning.id}
            onSubmit={handleTaskFormSubmit}
            onCancel={() => { setShowTaskForm(false); setEditingTask(null); }}
          />
        )}
      </div>
    </>
  );
}
