import { useState, useCallback } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Planning, PlanningFormData } from '../../types';
import styles from './PlanningList.module.css';

interface PlanningListProps {
  plannings: Planning[];
  activePlanningId: string | null;
  onSelect: (planning: Planning) => void;
  onCreate: (data: PlanningFormData) => void;
  onUpdate: (id: string, data: Partial<PlanningFormData>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function PlanningList({
  plannings,
  activePlanningId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: PlanningListProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState<Planning | null>(null);

  const handleCreate = useCallback(() => {
    setEditingPlanning(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((e: React.MouseEvent, planning: Planning) => {
    e.stopPropagation();
    setEditingPlanning(planning);
    setShowForm(true);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDelete(id);
  }, [onDelete]);

  const handleFormSubmit = useCallback((data: PlanningFormData) => {
    if (editingPlanning) {
      onUpdate(editingPlanning.id, data);
    } else {
      onCreate(data);
    }
    setShowForm(false);
    setEditingPlanning(null);
  }, [editingPlanning, onCreate, onUpdate]);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingPlanning(null);
  }, []);

  if (showForm) {
    return (
      <PlanningForm
        planning={editingPlanning}
        onSubmit={handleFormSubmit}
        onClose={handleFormClose}
      />
    );
  }

  return (
    <Modal title="Plannings" onClose={onClose} maxWidth={520}>
      <div className={styles.content}>
        <div className={styles.list}>
          {plannings.map((p) => (
            <div
              key={p.id}
              className={`${styles.item} ${p.id === activePlanningId ? styles.itemActive : ''}`}
              onClick={() => onSelect(p)}
            >
              <div className={styles.itemInfo}>
                <div className={styles.itemName}>{p.name}</div>
                <div className={styles.itemDates}>
                  {p.startDate} &mdash; {p.endDate}
                </div>
                {p.description && (
                  <div className={styles.itemDesc}>{p.description}</div>
                )}
              </div>
              <div className={styles.itemActions}>
                <button
                  className={styles.iconBtn}
                  onClick={(e) => handleEdit(e, p)}
                  title="Modifier"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  onClick={(e) => handleDelete(e, p.id)}
                  title="Supprimer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {plannings.length === 0 && (
            <div className={styles.empty}>Aucun planning</div>
          )}
        </div>
        <button className={styles.addBtn} onClick={handleCreate}>
          + Nouveau planning
        </button>
      </div>
    </Modal>
  );
}

// Internal planning form
function PlanningForm({
  planning,
  onSubmit,
  onClose,
}: {
  planning: Planning | null;
  onSubmit: (data: PlanningFormData) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-01-01`;
  const defaultEnd = `${today.getFullYear()}-12-31`;

  const [name, setName] = useState(planning?.name || '');
  const [description, setDescription] = useState(planning?.description || '');
  const [startDate, setStartDate] = useState(planning?.startDate || defaultStart);
  const [endDate, setEndDate] = useState(planning?.endDate || defaultEnd);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) return;
    onSubmit({ name: name.trim(), description, startDate, endDate });
  };

  const isEdit = !!planning;

  return (
    <Modal title={isEdit ? 'Modifier le planning' : 'Nouveau planning'} onClose={onClose} maxWidth={480}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Nom</label>
          <input
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon planning 2026"
            required
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Date de debut</label>
            <input
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Date de fin</label>
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description optionnelle"
            rows={2}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className={styles.submitBtn}>
            {isEdit ? 'Modifier' : 'Creer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
