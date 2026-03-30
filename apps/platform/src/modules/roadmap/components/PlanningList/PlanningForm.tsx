import { useState } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Planning, PlanningFormData } from '../../types';
import styles from './PlanningList.module.css';

interface PlanningFormProps {
  planning?: Planning | null;
  onSubmit: (data: PlanningFormData) => void;
  onClose: () => void;
}

export function PlanningForm({ planning, onSubmit, onClose }: PlanningFormProps) {
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
            <label className={styles.label}>Date de début</label>
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
            {isEdit ? 'Modifier' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
