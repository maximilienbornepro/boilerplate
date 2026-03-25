import { useState, useEffect, useCallback } from 'react';
import type { Task } from '../../types';
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

export function TaskForm({ task, parentTasks: _parentTasks = [], planningId, onSubmit, onCancel, onDelete }: TaskFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    color: TASK_COLORS[0],
    parentId: '' as string,
  });
  const [copied, setCopied] = useState(false);

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
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{task ? 'Modifier la tache' : 'Nouvelle tache'}</h2>
          <button className={styles.closeButton} onClick={onCancel}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Nom *</label>
            <input id="name" type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Nom de la tache" required autoFocus />
          </div>

          <div className={styles.formGroup}>
            <label>Couleur</label>
            <div className={styles.colorPicker}>
              {TASK_COLORS.map((color) => (
                <button key={color} type="button" className={`${styles.colorOption} ${formData.color === color ? styles.selected : ''}`} style={{ backgroundColor: color }} onClick={() => setFormData({ ...formData, color })} />
              ))}
            </div>
          </div>

          <div className={styles.actions}>
            {task && onDelete && (
              <button type="button" className={styles.deleteButton} onClick={onDelete}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                Supprimer
              </button>
            )}
            {task && planningId && (
              <button type="button" className={styles.embedButton} onClick={handleCopyEmbedLink}>
                {copied ? 'Copie !' : 'Lien embed'}
              </button>
            )}
            <button type="button" className={styles.cancelButton} onClick={onCancel}>Annuler</button>
            <button type="submit" className={styles.submitButton}>{task ? 'Modifier' : 'Creer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
