import { useState } from 'react';
import { Modal, FormField, Button } from '@boilerplate/shared/components';
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

  const handleSubmit = () => {
    if (!name.trim() || !startDate || !endDate) return;
    onSubmit({ name: name.trim(), description, startDate, endDate });
  };

  const isEdit = !!planning;

  return (
    <Modal title={isEdit ? 'Modifier le planning' : 'Nouveau planning'} onClose={onClose}>
      <div className={styles.modalBody}>
        <FormField label="Nom" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mon planning 2026"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </FormField>

        <div className={styles.row}>
          <FormField label="Date de début" required>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Date de fin" required>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
          </FormField>
        </div>

        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description optionnelle"
            rows={2}
          />
        </FormField>

        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!name.trim() || !startDate || !endDate}>
            {isEdit ? 'Modifier' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
