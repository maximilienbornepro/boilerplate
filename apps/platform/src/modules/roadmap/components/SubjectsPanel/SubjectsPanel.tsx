/**
 * TaskSidePanel — combined right-side panel showing:
 *   1. Task editing (name, color, progress)
 *   2. Linked SuiviTess subjects
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Task } from '../../types';
import { TASK_COLORS } from '../../utils/taskUtils';
import * as api from '../../services/api';
import type { LinkedSubject } from '../../services/api';
import { searchSubjects } from '../../../suivitess/services/api';
import type { SubjectSearchResult } from '../../../suivitess/services/api';
import { SubjectReview } from '../../../suivitess/components/SubjectReview/SubjectReview';
import type { Subject as SuiviTessSubject } from '../../../suivitess/types';
import './SubjectsPanel.css';

interface SubjectsPanelProps {
  task: Task;
  planningId?: string;
  onClose: () => void;
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete: (taskId: string) => void;
  onNavigateToSuiviTess?: (docId: string) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function toSuiviTessSubject(s: LinkedSubject): SuiviTessSubject {
  return {
    id: s.id,
    section_id: '',
    title: s.title,
    situation: s.situation,
    status: s.status,
    responsibility: s.responsibility,
    position: 0,
    created_at: '',
    updated_at: '',
  };
}

export function SubjectsPanel({
  task,
  planningId,
  onClose,
  onTaskUpdate,
  onTaskDelete,
  onNavigateToSuiviTess,
}: SubjectsPanelProps) {

  // ── Task editing ──────────────────────────────────────────────────────
  const [taskName, setTaskName] = useState(task.name);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Sync when the task prop changes (user clicks another task)
  useEffect(() => {
    setTaskName(task.name);
  }, [task.id]);

  const saveTaskName = useCallback(() => {
    const trimmed = taskName.trim();
    if (trimmed && trimmed !== task.name) {
      onTaskUpdate(task.id, { name: trimmed });
    } else {
      setTaskName(task.name); // revert if empty
    }
  }, [task.id, task.name, taskName, onTaskUpdate]);

  const saveColor = useCallback((color: string) => {
    onTaskUpdate(task.id, { color });
  }, [task.id, onTaskUpdate]);

  const handleCopyEmbed = useCallback(async () => {
    if (!planningId) return;
    const url = `${window.location.origin}/roadmap?embed=${planningId}&focus=${task.id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  }, [planningId, task.id]);

  const handleDelete = useCallback(() => {
    if (confirm(`Supprimer la tâche « ${task.name} » ?`)) {
      onTaskDelete(task.id);
      onClose();
    }
  }, [task.id, task.name, onTaskDelete, onClose]);

  // ── Subjects ──────────────────────────────────────────────────────────
  const [subjects, setSubjects] = useState<LinkedSubject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SubjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);
  const saveRegistryRef = useRef<Map<string, () => Promise<void>>>(new Map());

  const loadSubjects = useCallback(async () => {
    try {
      setSubjectsLoading(true);
      setSubjects(await api.fetchLinkedSubjects(task.id));
    } catch {
      setError('Erreur lors du chargement des sujets');
    } finally {
      setSubjectsLoading(false);
    }
  }, [task.id]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  useEffect(() => {
    if (debouncedQuery.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    setSearchLoading(true);
    searchSubjects(debouncedQuery)
      .then(results => {
        const linked = new Set(subjects.map(s => s.id));
        setSearchResults(results.filter(r => !linked.has(r.id)));
        setShowDropdown(true);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  }, [debouncedQuery, subjects]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLink = useCallback(async (result: SubjectSearchResult) => {
    try {
      await api.linkSubject(task.id, result.id);
      setSearchQuery(''); setShowDropdown(false);
      await loadSubjects();
    } catch { setError('Erreur lors de la liaison'); }
  }, [task.id, loadSubjects]);

  const handleUnlink = useCallback(async (subjectId: string) => {
    try {
      await api.unlinkSubject(task.id, subjectId);
      setSubjects(prev => prev.filter(s => s.id !== subjectId));
    } catch { setError('Erreur lors de la déliaison'); }
  }, [task.id]);

  const registerSave = useCallback((id: string, fn: () => Promise<void>) => {
    saveRegistryRef.current.set(id, fn);
  }, []);
  const unregisterSave = useCallback((id: string) => {
    saveRegistryRef.current.delete(id);
  }, []);

  const handleCloseSubjectEdit = useCallback(async () => {
    if (editingSubjectId) {
      const saveFn = saveRegistryRef.current.get(editingSubjectId);
      if (saveFn) await saveFn().catch(() => {});
    }
    setEditingSubjectId(null);
    await loadSubjects();
  }, [editingSubjectId, loadSubjects]);

  const handleSubjectSaved = useCallback((updated: SuiviTessSubject) => {
    setSubjects(prev => prev.map(s => s.id === updated.id ? {
      ...s,
      title: updated.title,
      situation: updated.situation,
      status: updated.status,
      responsibility: updated.responsibility,
    } : s));
  }, []);

  return (
    <div className="sp-panel">

      {/* ── Header ── */}
      <div className="sp-header">
        <div className="sp-header-info">
          <div className="sp-header-label">TÂCHE</div>
        </div>
        <button className="sp-close" onClick={onClose} title="Fermer">×</button>
      </div>

      {error && <div className="sp-error">{error}</div>}

      <div className="sp-scrollable">

        {/* ── Task editing ── */}
        <div className="sp-task-section">

          {/* Name */}
          <div className="sp-field">
            <label className="sp-label">Nom</label>
            <input
              className="sp-task-name-input"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              onBlur={saveTaskName}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="Nom de la tâche"
            />
          </div>

          {/* Color */}
          <div className="sp-field">
            <label className="sp-label">Couleur</label>
            <div className="sp-color-grid">
              {TASK_COLORS.map(color => (
                <button
                  key={color}
                  className={`sp-color-swatch ${task.color === color ? 'sp-color-swatch--selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => saveColor(color)}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="sp-task-actions">
            {planningId && (
              <button className="sp-btn" onClick={handleCopyEmbed}>
                {copiedEmbed ? '✓ Copié !' : 'Lien embed'}
              </button>
            )}
            <button className="sp-btn sp-btn-danger" onClick={handleDelete}>
              Supprimer
            </button>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="sp-divider">
          <span className="sp-divider-label">Sujets SuiviTess liés</span>
        </div>

        {/* ── Search to link subjects ── */}
        {!editingSubjectId && (
          <div className="sp-search-section" ref={searchRef}>
            <div className="sp-search-wrapper">
              <span className="sp-search-icon">🔍</span>
              <input
                className="sp-search-input"
                type="text"
                placeholder="Rechercher un sujet SuiviTess..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              />
              {searchLoading && <span className="sp-search-spinner">⏳</span>}
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="sp-dropdown">
                {searchResults.map(result => (
                  <button key={result.id} className="sp-dropdown-item" onClick={() => handleLink(result)}>
                    <span className="sp-dropdown-status">{result.status.split(' ')[0]}</span>
                    <span className="sp-dropdown-title">{result.title}</span>
                    <span className="sp-dropdown-doc">{result.document_title}</span>
                  </button>
                ))}
              </div>
            )}
            {showDropdown && searchResults.length === 0 && debouncedQuery.length >= 2 && !searchLoading && (
              <div className="sp-dropdown sp-dropdown-empty">Aucun sujet trouvé</div>
            )}
          </div>
        )}

        {/* ── Subjects list ── */}
        <div className="sp-subjects">
          {subjectsLoading && <div className="sp-loading">Chargement...</div>}
          {!subjectsLoading && subjects.length === 0 && (
            <div className="sp-empty">Aucun sujet lié. Recherchez ci-dessus pour en ajouter.</div>
          )}

          {subjects.map(subject => (
            <div key={subject.id} className={`sp-subject-card ${editingSubjectId === subject.id ? 'sp-subject-card--editing' : ''}`}>

              {/* Breadcrumb */}
              <div className="sp-subject-meta">
                <span className="sp-subject-doc">{subject.document_title}</span>
                <span className="sp-subject-sep">›</span>
                <span className="sp-subject-section">{subject.section_name}</span>
                {onNavigateToSuiviTess && (
                  <button
                    className="sp-subject-open"
                    onClick={() => onNavigateToSuiviTess(subject.document_id)}
                    title="Ouvrir dans SuiviTess"
                  >↗</button>
                )}
              </div>

              {editingSubjectId === subject.id ? (
                /* Edit mode: full SubjectReview in compact mode */
                <div className="sp-subject-edit-wrapper">
                  <SubjectReview
                    subject={toSuiviTessSubject(subject)}
                    sectionName={subject.section_name}
                    documentId={subject.document_id}
                    compact
                    onNext={handleCloseSubjectEdit}
                    onSaved={handleSubjectSaved}
                    registerSave={registerSave}
                    unregisterSave={unregisterSave}
                  />
                  <button className="sp-btn" onClick={handleCloseSubjectEdit}>
                    ← Fermer l'édition
                  </button>
                </div>
              ) : (
                /* View mode */
                <div className="sp-subject-view">
                  <div className="sp-subject-title-row">
                    <span className="sp-subject-status">{subject.status}</span>
                    <span className="sp-subject-title">{subject.title}</span>
                  </div>
                  {subject.situation && (
                    <div className="sp-subject-situation">{subject.situation}</div>
                  )}
                  {subject.responsibility && (
                    <div className="sp-subject-responsibility">👤 {subject.responsibility}</div>
                  )}
                  <div className="sp-subject-actions">
                    <button className="sp-btn sp-btn-primary" onClick={() => setEditingSubjectId(subject.id)}>
                      Éditer
                    </button>
                    <button
                      className="sp-btn sp-btn-danger"
                      onClick={() => handleUnlink(subject.id)}
                      title="Délier ce sujet"
                    >Délier</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

      </div>{/* end scrollable */}
    </div>
  );
}
