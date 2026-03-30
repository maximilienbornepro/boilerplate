import { useState, useEffect, useCallback, useRef } from 'react';
import type { Task } from '../../types';
import * as api from '../../services/api';
import type { LinkedSubject } from '../../services/api';
import { searchSubjects } from '../../../suivitess/services/api';
import type { SubjectSearchResult } from '../../../suivitess/services/api';
import './SubjectsPanel.css';

const STATUS_OPTIONS = [
  '🔴 à faire',
  '🟡 en cours',
  '🟢 fait',
  '⚪ annulé',
];

interface SubjectsPanelProps {
  task: Task;
  onClose: () => void;
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

interface EditingState {
  title: string;
  situation: string;
  status: string;
  responsibility: string;
}

export function SubjectsPanel({ task, onClose, onNavigateToSuiviTess }: SubjectsPanelProps) {
  const [subjects, setSubjects] = useState<LinkedSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SubjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingState, setEditingState] = useState<EditingState>({ title: '', situation: '', status: '', responsibility: '' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const loadSubjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetchLinkedSubjects(task.id);
      setSubjects(data);
    } catch {
      setError('Erreur lors du chargement des sujets');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearchLoading(true);
    searchSubjects(debouncedQuery)
      .then(results => {
        // Filter out already linked subjects
        const linkedIds = new Set(subjects.map(s => s.id));
        setSearchResults(results.filter(r => !linkedIds.has(r.id)));
        setShowDropdown(true);
      })
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  }, [debouncedQuery, subjects]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLink = useCallback(async (result: SubjectSearchResult) => {
    try {
      await api.linkSubject(task.id, result.id);
      setSearchQuery('');
      setShowDropdown(false);
      await loadSubjects();
    } catch {
      setError('Erreur lors de la liaison');
    }
  }, [task.id, loadSubjects]);

  const handleUnlink = useCallback(async (subjectId: string) => {
    try {
      await api.unlinkSubject(task.id, subjectId);
      setSubjects(prev => prev.filter(s => s.id !== subjectId));
    } catch {
      setError('Erreur lors de la déliaison');
    }
  }, [task.id]);

  const startEdit = useCallback((subject: LinkedSubject) => {
    setEditingId(subject.id);
    setEditingState({
      title: subject.title,
      situation: subject.situation || '',
      status: subject.status,
      responsibility: subject.responsibility || '',
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async (subjectId: string) => {
    setSavingId(subjectId);
    try {
      await api.updateSubject(subjectId, {
        title: editingState.title,
        situation: editingState.situation,
        status: editingState.status,
        responsibility: editingState.responsibility,
      });
      setSubjects(prev => prev.map(s => s.id === subjectId ? {
        ...s,
        title: editingState.title,
        situation: editingState.situation || null,
        status: editingState.status,
        responsibility: editingState.responsibility || null,
      } : s));
      setEditingId(null);
    } catch {
      setError('Erreur lors de la sauvegarde');
    } finally {
      setSavingId(null);
    }
  }, [editingState]);

  return (
    <div className="sp-panel">
      <div className="sp-header">
        <div className="sp-header-info">
          <div className="sp-header-label">SUJETS LIÉS</div>
          <div className="sp-header-task">{task.name}</div>
        </div>
        <button className="sp-close" onClick={onClose} title="Fermer">×</button>
      </div>

      {error && <div className="sp-error">{error}</div>}

      {/* Search to link new subjects */}
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
              <button
                key={result.id}
                className="sp-dropdown-item"
                onClick={() => handleLink(result)}
              >
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

      {/* Linked subjects list */}
      <div className="sp-subjects">
        {loading && <div className="sp-loading">Chargement...</div>}
        {!loading && subjects.length === 0 && (
          <div className="sp-empty">Aucun sujet lié. Recherchez ci-dessus pour en ajouter.</div>
        )}
        {subjects.map(subject => (
          <div key={subject.id} className="sp-subject-card">
            <div className="sp-subject-meta">
              <span className="sp-subject-doc">{subject.document_title}</span>
              <span className="sp-subject-sep">›</span>
              <span className="sp-subject-section">{subject.section_name}</span>
              {onNavigateToSuiviTess && (
                <button
                  className="sp-subject-open"
                  onClick={() => onNavigateToSuiviTess(subject.document_id)}
                  title="Ouvrir dans SuiviTess"
                >
                  ↗
                </button>
              )}
            </div>

            {editingId === subject.id ? (
              <div className="sp-subject-edit">
                <input
                  className="sp-input"
                  value={editingState.title}
                  onChange={e => setEditingState(s => ({ ...s, title: e.target.value }))}
                  placeholder="Titre du sujet"
                />
                <select
                  className="sp-select"
                  value={editingState.status}
                  onChange={e => setEditingState(s => ({ ...s, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <textarea
                  className="sp-textarea"
                  value={editingState.situation}
                  onChange={e => setEditingState(s => ({ ...s, situation: e.target.value }))}
                  placeholder="Situation / Description"
                  rows={3}
                />
                <input
                  className="sp-input"
                  value={editingState.responsibility}
                  onChange={e => setEditingState(s => ({ ...s, responsibility: e.target.value }))}
                  placeholder="Responsable"
                />
                <div className="sp-edit-actions">
                  <button
                    className="sp-btn sp-btn-primary"
                    onClick={() => saveEdit(subject.id)}
                    disabled={savingId === subject.id}
                  >
                    {savingId === subject.id ? 'Sauvegarde...' : 'Sauvegarder'}
                  </button>
                  <button className="sp-btn sp-btn-cancel" onClick={cancelEdit}>Annuler</button>
                </div>
              </div>
            ) : (
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
                  <button className="sp-btn sp-btn-edit" onClick={() => startEdit(subject)}>
                    Éditer
                  </button>
                  <button
                    className="sp-btn sp-btn-unlink"
                    onClick={() => handleUnlink(subject.id)}
                    title="Délier ce sujet"
                  >
                    × Délier
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
