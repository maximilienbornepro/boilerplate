import { useState } from 'react';
import styles from './RestoreModal.module.css';

interface HiddenTask {
  taskId: string;
  title?: string;
}

interface RestoreModalProps {
  hiddenTasks: HiddenTask[];
  onRestore: (taskIds: string[]) => void;
  onClose: () => void;
}

export function RestoreModal({ hiddenTasks, onRestore, onClose }: RestoreModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = (taskId: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(taskId)) {
      newSelection.delete(taskId);
    } else {
      newSelection.add(taskId);
    }
    setSelectedIds(newSelection);
  };

  const selectAll = () => {
    setSelectedIds(new Set(hiddenTasks.map(t => t.taskId)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleRestore = () => {
    if (selectedIds.size > 0) {
      onRestore(Array.from(selectedIds));
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Restaurer des taches masquees</h3>
          <button className={styles.closeBtn} onClick={onClose}>x</button>
        </div>

        <div className={styles.actions}>
          <button className={styles.selectBtn} onClick={selectAll}>Tout selectionner</button>
          <button className={styles.selectBtn} onClick={deselectAll}>Tout deselectionner</button>
        </div>

        <div className={styles.list}>
          {hiddenTasks.map((task) => (
            <label key={task.taskId} className={styles.item}>
              <input
                type="checkbox"
                checked={selectedIds.has(task.taskId)}
                onChange={() => toggleSelection(task.taskId)}
              />
              <span className={styles.taskId}>{task.taskId.slice(0, 8)}...</span>
              {task.title && <span className={styles.title}>{task.title}</span>}
            </label>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Annuler
          </button>
          <button
            className={styles.restoreBtn}
            onClick={handleRestore}
            disabled={selectedIds.size === 0}
          >
            Restaurer ({selectedIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}
