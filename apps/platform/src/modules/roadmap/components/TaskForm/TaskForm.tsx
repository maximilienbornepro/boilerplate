import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, ModalBody, ModalActions, Button } from '@boilerplate/shared/components';
import type { Task } from '../../types';
import * as api from '../../services/api';
import type { LinkedSubject } from '../../services/api';
import { searchSubjects } from '../../../suivitess/services/api';
import type { SubjectSearchResult } from '../../../suivitess/services/api';
import { TASK_COLORS } from '../../utils/taskUtils';
import styles from './TaskForm.module.css';

interface TaskFormProps {
  task?: Task | null;
  parentTasks?: Task[];
  planningId?: string;
  onSubmit: (data: { name: string; color: string; parentId?: string | null }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function TaskForm({ task, parentTasks: _parentTasks = [], planningId, onSubmit, onCancel, onDelete }: TaskFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    color: TASK_COLORS[0],
    parentId: '' as string,
  });
  const [copied, setCopied] = useState(false);

  // Subjects (integration)
  const [subjects, setSubjects] = useState<LinkedSubject[]>([]);
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectResults, setSubjectResults] = useState<SubjectSearchResult[]>([]);
  const [subjectSearchLoading, setSubjectSearchLoading] = useState(false);
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
  const subjectSearchRef = useRef<HTMLDivElement>(null);
  const debouncedSubjectSearch = useDebounce(subjectSearch, 300);

  const loadSubjects = useCallback(async () => {
    if (!task?.id) return;
    try {
      const data = await api.fetchLinkedSubjects(task.id);
      setSubjects(data);
    } catch { /* silently */ }
  }, [task?.id]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  useEffect(() => {
    if (debouncedSubjectSearch.length < 2) {
      setSubjectResults([]);
      setShowSubjectDropdown(false);
      return;
    }
    setSubjectSearchLoading(true);
    searchSubjects(debouncedSubjectSearch)
      .then(results => {
        const linkedIds = new Set(subjects.map(s => s.id));
        setSubjectResults(results.filter(r => !linkedIds.has(r.id)));
        setShowSubjectDropdown(true);
      })
      .catch(() => setSubjectResults([]))
      .finally(() => setSubjectSearchLoading(false));
  }, [debouncedSubjectSearch, subjects]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (subjectSearchRef.current && !subjectSearchRef.current.contains(e.target as Node)) {
        setShowSubjectDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLinkSubject = useCallback(async (result: SubjectSearchResult) => {
    if (!task?.id) return;
    try {
      await api.linkSubject(task.id, result.id);
      setSubjectSearch('');
      setShowSubjectDropdown(false);
      await loadSubjects();
    } catch { /* silently */ }
  }, [task?.id, loadSubjects]);

  const handleUnlinkSubject = useCallback(async (subjectId: string) => {
    if (!task?.id) return;
    try {
      await api.unlinkSubject(task.id, subjectId);
      setSubjects(prev => prev.filter(s => s.id !== subjectId));
    } catch { /* silently */ }
  }, [task?.id]);

  useEffect(() => {
    if (task) {
      setFormData({ name: task.name, color: task.color, parentId: task.parentId || '' });
    }
  }, [task]);

  const handleCopyEmbedLink = useCallback(async () => {
    if (!task || !planningId) return;
    const url = `${window.location.origin}/roadmap?embed=${planningId}&focus=${task.id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* fallback */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [task, planningId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...formData, parentId: formData.parentId || null });
  };

  return (
    <Modal title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onCancel} size="md">
      <form onSubmit={handleSubmit}>
        <ModalBody>
          <div className={styles.formGroup}>
            <label htmlFor="name">Nom *</label>
            <input id="name" type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Nom de la tâche" required autoFocus />
          </div>

          {/* SuiviTess subjects — shown when editing an existing task (always available) */}
          {task && (
            <div className={styles.formGroup}>
              <label>Sujets SuiviTess liés</label>

              {/* Search */}
              <div className={styles.subjectSearchWrapper} ref={subjectSearchRef}>
                <input
                  type="text"
                  className={styles.subjectSearchInput}
                  placeholder="Rechercher un sujet..."
                  value={subjectSearch}
                  onChange={e => setSubjectSearch(e.target.value)}
                  onFocus={() => subjectResults.length > 0 && setShowSubjectDropdown(true)}
                />
                {subjectSearchLoading && <span className={styles.subjectSpinner}>⏳</span>}
                {showSubjectDropdown && subjectResults.length > 0 && (
                  <div className={styles.subjectDropdown}>
                    {subjectResults.map(r => (
                      <button key={r.id} type="button" className={styles.subjectDropdownItem} onClick={() => handleLinkSubject(r)}>
                        <span>{r.status.split(' ')[0]}</span>
                        <span className={styles.subjectDropdownTitle}>{r.title}</span>
                        <span className={styles.subjectDropdownDoc}>{r.document_title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked list */}
              {subjects.length > 0 && (
                <ul className={styles.subjectList}>
                  {subjects.map(s => (
                    <li key={s.id} className={styles.subjectItem}>
                      <span className={styles.subjectItemStatus}>{s.status.split(' ')[0]}</span>
                      <span className={styles.subjectItemTitle}>{s.title}</span>
                      <span className={styles.subjectItemDoc}>{s.document_title}</span>
                      <button type="button" className={styles.subjectItemUnlink} onClick={() => handleUnlinkSubject(s.id)} title="Délier">×</button>
                    </li>
                  ))}
                </ul>
              )}
              {subjects.length === 0 && (
                <div className={styles.subjectEmpty}>Aucun sujet lié</div>
              )}
            </div>
          )}

        </ModalBody>
        <ModalActions>
          {task && onDelete && (
            <Button variant="danger" type="button" onClick={onDelete}>
              Supprimer
            </Button>
          )}
          {task && planningId && (
            <Button variant="secondary" type="button" onClick={handleCopyEmbedLink}>
              {copied ? 'Copié !' : 'Lien embed'}
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onCancel}>Annuler</Button>
          <Button variant="primary" type="submit">{task ? 'Modifier' : 'Créer'}</Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
