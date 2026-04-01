/**
 * TaskSidePanel — combined right-side panel showing:
 *   1. Task editing (name, color, progress)
 *   2. Linked SuiviTess subjects
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Task } from '../../types';
import * as api from '../../services/api';
import type { LinkedSubject } from '../../services/api';
import { searchSubjects, fetchDocuments, fetchDocument, createSection, createSubject as createSuiviTessSubject } from '../../../suivitess/services/api';
import type { SubjectSearchResult } from '../../../suivitess/services/api';
import type { Document as SuiviTessDoc } from '../../../suivitess/types';
import { SubjectReview } from '../../../suivitess/components/SubjectReview/SubjectReview';
import type { Subject as SuiviTessSubject } from '../../../suivitess/types';
import './SubjectsPanel.css';

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

interface SubjectsPanelProps {
  task: Task;
  planningId?: string;
  onClose: () => void;
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete: (taskId: string) => void;
  onNavigateToSuiviTess?: (docId: string, sectionId?: string) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Truncate situation: show "..." + last non-empty line */
function truncateSituation(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length <= 1) return text.trim();
  return `… ${lines[lines.length - 1].trim()}`;
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

  // New subject creation
  const [showNewSubject, setShowNewSubject] = useState(false);
  const [newSubjectTitle, setNewSubjectTitle] = useState('');
  const [availableDocs, setAvailableDocs] = useState<SuiviTessDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
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

  const ROADMAP_SECTION_NAME = 'Créé depuis la Roadmap';

  const handleOpenNewSubject = useCallback(async () => {
    setShowNewSubject(true);
    try {
      const docs = await fetchDocuments();
      setAvailableDocs(docs);
      if (docs.length > 0 && !selectedDocId) setSelectedDocId(docs[0].id);
    } catch {
      setError('Erreur lors du chargement des documents');
    }
  }, [selectedDocId]);

  const handleCreateSubject = useCallback(async () => {
    if (!newSubjectTitle.trim() || !selectedDocId) return;
    setCreatingSubject(true);
    setError('');
    try {
      // Find or create "Créé depuis la Roadmap" section in the selected document
      const doc = await fetchDocument(selectedDocId);
      let section = doc.sections.find(s => s.name === ROADMAP_SECTION_NAME);
      if (!section) {
        section = await createSection(selectedDocId, ROADMAP_SECTION_NAME);
      }

      // Create the subject in that section
      const newSubject = await createSuiviTessSubject(section.id, {
        title: newSubjectTitle.trim(),
        status: '🔴 à faire',
        responsibility: '@Responsable',
      });

      // Link it to the current task
      await api.linkSubject(task.id, newSubject.id);

      // Reset form and reload
      setNewSubjectTitle('');
      setShowNewSubject(false);
      await loadSubjects();
    } catch {
      setError('Erreur lors de la création du sujet');
    } finally {
      setCreatingSubject(false);
    }
  }, [newSubjectTitle, selectedDocId, task.id, loadSubjects]);

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
          <div className="sp-header-label">
            <span className="sp-task-color-dot" style={{ backgroundColor: task.color }} />
            TÂCHE
          </div>
          <input
            className="sp-task-name-input"
            value={taskName}
            onChange={e => setTaskName(e.target.value)}
            onBlur={saveTaskName}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Nom de la tâche"
          />
        </div>
        <button className="sp-close" onClick={onClose} title="Fermer">×</button>
      </div>

      {error && <div className="sp-error">{error}</div>}

      <div className="sp-scrollable">

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
                    <span className="sp-dropdown-doc">{result.document_title} › {result.section_name}</span>
                  </button>
                ))}
              </div>
            )}
            {showDropdown && searchResults.length === 0 && debouncedQuery.length >= 2 && !searchLoading && (
              <div className="sp-dropdown sp-dropdown-empty">Aucun sujet trouvé</div>
            )}
          </div>
        )}

        {/* ── New subject form ── */}
        {!editingSubjectId && (
          <div className="sp-new-subject-section">
            {!showNewSubject ? (
              <button className="sp-btn sp-btn-new" onClick={handleOpenNewSubject}>
                + Nouveau sujet
              </button>
            ) : (
              <div className="sp-new-subject-form">
                <select
                  className="sp-new-subject-select"
                  value={selectedDocId}
                  onChange={e => setSelectedDocId(e.target.value)}
                >
                  {availableDocs.map(doc => (
                    <option key={doc.id} value={doc.id}>{doc.title}</option>
                  ))}
                </select>
                <input
                  className="sp-new-subject-input"
                  type="text"
                  placeholder="Titre du sujet..."
                  value={newSubjectTitle}
                  onChange={e => setNewSubjectTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateSubject(); }}
                  autoFocus
                />
                <div className="sp-new-subject-hint">
                  Sera ajouté dans la section « {ROADMAP_SECTION_NAME} »
                </div>
                <div className="sp-new-subject-actions">
                  <button
                    className="sp-btn sp-btn-primary"
                    onClick={handleCreateSubject}
                    disabled={creatingSubject || !newSubjectTitle.trim()}
                  >
                    {creatingSubject ? 'Création...' : 'Créer et lier'}
                  </button>
                  <button className="sp-btn" onClick={() => setShowNewSubject(false)}>
                    Annuler
                  </button>
                </div>
              </div>
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
                  <a
                    className="sp-subject-open"
                    href={`/suivitess/${subject.document_id}?section=${subject.section_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ouvrir dans SuiviTess"
                  >↗</a>
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
                    <span className="sp-subject-title">{subject.title}</span>
                  </div>
                  <span className="sp-subject-status-badge">{subject.status}</span>
                  {subject.situation && (
                    <div className="sp-subject-situation">{truncateSituation(subject.situation)}</div>
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

      {/* ── Compact footer ── */}
      <div className="sp-footer">
        <div className="sp-footer-actions">
          {planningId && (
            <button
              className={`sp-footer-btn ${copiedEmbed ? 'sp-footer-btn--copied' : ''}`}
              onClick={handleCopyEmbed}
              title="Copier le lien embed"
            >
              {copiedEmbed ? '✓' : <LinkIcon />}
            </button>
          )}
          <button
            className="sp-footer-btn sp-footer-btn--danger"
            onClick={handleDelete}
            title="Supprimer la tâche"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
