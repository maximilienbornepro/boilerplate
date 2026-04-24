import { useState } from 'react';
import { Modal, ModalBody, ModalActions, Button } from '@boilerplate/shared/components';
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
    <Modal title="Restaurer des tâches masquées" onClose={onClose} size="md">
      <ModalBody>
        <div className={styles.actions}>
          <button className={styles.selectBtn} onClick={selectAll}>Tout sélectionner</button>
          <button className={styles.selectBtn} onClick={deselectAll}>Tout désélectionner</button>
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
      </ModalBody>
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button variant="primary" onClick={handleRestore} disabled={selectedIds.size === 0}>
          Restaurer ({selectedIds.size})
        </Button>
      </ModalActions>
    </Modal>
  );
}
