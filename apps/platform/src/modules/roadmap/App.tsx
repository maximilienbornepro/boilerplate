import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, LoadingSpinner, ModuleHeader } from '@boilerplate/shared/components';
import type { Planning, Task, Dependency, ViewMode, Marker } from './types';
import * as api from './services/api';
import { getNextColor } from './utils/taskUtils';
import { PlanningList } from './components/PlanningList/PlanningList';
import { GanttBoard } from './components/GanttBoard/GanttBoard';
import { TaskForm } from './components/TaskForm/TaskForm';
import { ViewSelector } from './components/ViewSelector/ViewSelector';
import './index.css';

function getUrlPlanningId(): string | null {
  return new URLSearchParams(window.location.search).get('id');
}

function getEmbedPlanningId(): string | null {
  return new URLSearchParams(window.location.search).get('embed');
}

export default function RoadmapApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const embedPlanningId = getEmbedPlanningId();

  if (embedPlanningId) {
    return <EmbedView planningId={embedPlanningId} />;
  }

  return (
    <Layout appId="roadmap" variant="full-width" onNavigate={onNavigate}>
      <AppContentInner onNavigate={onNavigate} />
    </Layout>
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
          planning={planning} tasks={tasks} dependencies={dependencies} viewMode={viewMode} markers={markers}
          onTaskUpdate={noopTask} onTaskClick={noopClick} onTaskDelete={noopStr}
          onAddTask={noop} onAddChildTask={noopStr} onCreateDependency={noopDep} onDeleteDependency={noopStr}
          readOnly
        />
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================

function AppContentInner({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [plannings, setPlannings] = useState<Planning[]>([]);
  const [selectedPlanning, setSelectedPlanning] = useState<Planning | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);

  useEffect(() => { loadPlannings(); }, []);

  const hasRestoredFromUrl = useRef(false);

  useEffect(() => {
    const urlId = getUrlPlanningId();
    if (urlId && plannings.length > 0 && !selectedPlanning) {
      const found = plannings.find(p => p.id === urlId);
      if (found) setSelectedPlanning(found);
    }
    if (plannings.length > 0) hasRestoredFromUrl.current = true;
  }, [plannings]);

  useEffect(() => {
    if (!hasRestoredFromUrl.current) return;
    const url = new URL(window.location.href);
    if (selectedPlanning) url.searchParams.set('id', selectedPlanning.id);
    else url.searchParams.delete('id');
    history.replaceState(null, '', url.toString());
  }, [selectedPlanning]);

  useEffect(() => {
    if (selectedPlanning) loadPlanningData(selectedPlanning.id);
  }, [selectedPlanning]);

  const loadPlannings = async () => {
    try {
      setLoading(true);
      const data = await api.fetchPlannings();
      setPlannings(data);
    } catch { setError('Erreur lors du chargement des plannings'); }
    finally { setLoading(false); }
  };

  const loadPlanningData = async (planningId: string) => {
    try {
      setLoading(true);
      const [t, d, m] = await Promise.all([
        api.fetchTasks(planningId),
        api.fetchDependencies(planningId),
        api.fetchMarkers(planningId),
      ]);
      setTasks(t); setDependencies(d); setMarkers(m);
    } catch { setError('Erreur lors du chargement des donnees'); }
    finally { setLoading(false); }
  };

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
    } catch { setError('Erreur lors de la creation du planning'); }
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
  const handleTaskClick = (task: Task) => { setEditingTask(task); setShowTaskForm(true); };

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
        const task = await api.createTask({
          planningId: selectedPlanning.id,
          name: data.name,
          color: data.color,
          parentId: data.parentId || null,
          description: '',
          startDate,
          endDate,
          progress: 0,
        });
        setTasks(prev => [...prev, task]);
      }
      setShowTaskForm(false); setEditingTask(null);
    } catch { setError("Erreur lors de l'enregistrement de la tache"); }
  };

  const handleTaskDelete = async () => {
    if (!editingTask) return;
    try {
      await api.deleteTask(editingTask.id);
      setTasks(prev => prev.filter(t => t.id !== editingTask.id));
      setShowTaskForm(false); setEditingTask(null);
    } catch { setError('Erreur lors de la suppression de la tache'); }
  };

  const handleTaskDeleteDirect = useCallback(async (taskId: string) => {
    try {
      await api.deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId && t.parentId !== taskId));
    } catch { setError('Erreur lors de la suppression de la tache'); }
  }, []);

  const handleAddChildTask = useCallback(async (parentId: string) => {
    if (!selectedPlanning) return;
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const end = new Date(today); end.setDate(end.getDate() + 4);
    const endDate = end.toISOString().split('T')[0];
    const parentTask = tasks.find(t => t.id === parentId);
    const color = parentTask?.color || getNextColor(tasks.map(t => t.color));
    const existingChildren = tasks.filter(t => t.parentId === parentId);
    const name = `Sous-tache ${existingChildren.length + 1}`;
    try {
      const task = await api.createTask({ planningId: selectedPlanning.id, parentId, name, startDate, endDate, color, description: '', progress: 0 });
      setTasks(prev => [...prev, task]);
    } catch { setError('Erreur lors de la creation de la sous-tache'); }
  }, [selectedPlanning, tasks]);

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    try { await api.updateTask(taskId, updates); }
    catch { setError('Erreur lors de la mise a jour'); if (selectedPlanning) loadPlanningData(selectedPlanning.id); }
  }, [selectedPlanning]);

  // Dependency handlers
  const handleCreateDependency = useCallback(async (fromTaskId: string, toTaskId: string) => {
    try {
      const dep = await api.createDependency(fromTaskId, toTaskId);
      setDependencies(prev => [...prev, dep]);
    } catch { setError('Erreur lors de la creation de la dependance'); }
  }, []);

  const handleDeleteDependency = useCallback(async (depId: string) => {
    try {
      await api.deleteDependency(depId);
      setDependencies(prev => prev.filter(d => d.id !== depId));
    } catch { setError('Erreur lors de la suppression de la dependance'); }
  }, []);

  // Marker handlers
  const handleCreateMarker = useCallback(async () => {
    if (!selectedPlanning) return;
    const today = new Date().toISOString().split('T')[0];
    try {
      const marker = await api.createMarker(selectedPlanning.id, 'Marqueur', today);
      setMarkers(prev => [...prev, marker]);
    } catch { setError('Erreur lors de la creation du marqueur'); }
  }, [selectedPlanning]);

  const handleUpdateMarker = useCallback(async (markerId: string, data: Partial<{ name: string; markerDate: string; color: string; taskId: string | null }>) => {
    setMarkers(prev => prev.map(m => m.id === markerId ? { ...m, ...data } : m));
    try { await api.updateMarker(markerId, data); }
    catch { setError('Erreur lors de la mise a jour du marqueur'); if (selectedPlanning) api.fetchMarkers(selectedPlanning.id).then(setMarkers).catch(() => {}); }
  }, [selectedPlanning]);

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

  const handleNavigateHome = useCallback(() => {
    if (onNavigate) onNavigate('/'); else window.location.href = '/';
  }, [onNavigate]);

  const handleBack = () => {
    setSelectedPlanning(null); setTasks([]); setDependencies([]); setMarkers([]);
  };

  if (loading && !selectedPlanning && plannings.length === 0) {
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

      {selectedPlanning ? (
        <>
          <ModuleHeader title={selectedPlanning.name} onBack={handleBack}>
            <ViewSelector viewMode={viewMode} onViewModeChange={setViewMode} />
            <button className="module-header-btn" onClick={handleCopyPreviewLink}>
              {copiedPreview ? 'Copie !' : 'Lien'}
            </button>
          </ModuleHeader>

          <div className="roadmap-planning-view">
            <div className="roadmap-gantt-container">
              <GanttBoard
                planning={selectedPlanning}
                tasks={tasks}
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

            {showTaskForm && (
              <TaskForm
                task={editingTask}
                parentTasks={tasks.filter(t => t.id !== editingTask?.id)}
                planningId={selectedPlanning.id}
                onSubmit={handleTaskFormSubmit}
                onCancel={() => { setShowTaskForm(false); setEditingTask(null); }}
                onDelete={editingTask ? handleTaskDelete : undefined}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <ModuleHeader title="Roadmap" onBack={handleNavigateHome}>
            <button className="module-header-btn module-header-btn-primary" onClick={handleCreatePlanning}>
              + Nouveau
            </button>
          </ModuleHeader>
          <PlanningList
            plannings={plannings}
            onSelect={setSelectedPlanning}
            onEdit={handleEditPlanning}
            onDelete={handleDeletePlanning}
          />
        </>
      )}
    </>
  );
}
