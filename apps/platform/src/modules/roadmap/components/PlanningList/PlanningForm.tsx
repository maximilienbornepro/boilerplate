import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalActions, FormField, Button, VisibilityPicker } from '@boilerplate/shared/components';
import type { Visibility } from '@boilerplate/shared/components';
import type { Planning, PlanningFormData, LinkedDeliveryBoard } from '../../types';
import * as api from '../../services/api';
import styles from './PlanningList.module.css';

interface PlanningFormProps {
  planning?: Planning | null;
  /**
   * Called with the form data. Must return the created/updated Planning
   * so the form can link/unlink delivery boards against its id.
   * Returning null aborts the board-linking step.
   */
  onSubmit: (data: PlanningFormData) => Promise<Planning | null>;
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
  const [startDateTouched, setStartDateTouched] = useState(!!planning);
  const [endDateTouched, setEndDateTouched] = useState(!!planning);
  const [visibility, setVisibility] = useState<Visibility>('private');

  const [availableBoards, setAvailableBoards] = useState<LinkedDeliveryBoard[]>([]);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(new Set());
  const [initialBoardIds, setInitialBoardIds] = useState<Set<string>>(new Set());
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load all available delivery boards + (if editing) the currently linked ones.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await api.fetchAllDeliveryBoards();
        if (cancelled) return;
        setAvailableBoards(all);

        if (planning?.id) {
          const linked = await api.fetchLinkedBoards(planning.id);
          if (cancelled) return;
          const ids = new Set(linked.map(b => b.id));
          setSelectedBoardIds(ids);
          setInitialBoardIds(ids);
        }
      } catch {
        // Silent fail — delivery boards are optional.
      } finally {
        if (!cancelled) setBoardsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planning?.id]);

  const toggleBoard = (boardId: string) => {
    setSelectedBoardIds(prev => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const syncBoardLinks = async (planningId: string) => {
    const toLink = Array.from(selectedBoardIds).filter(id => !initialBoardIds.has(id));
    const toUnlink = Array.from(initialBoardIds).filter(id => !selectedBoardIds.has(id));

    await Promise.all([
      ...toLink.map(id => api.linkDeliveryBoard(planningId, id).catch(() => {})),
      ...toUnlink.map(id => api.unlinkDeliveryBoard(planningId, id).catch(() => {})),
    ]);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate || submitting) return;
    setSubmitting(true);
    try {
      const saved = await onSubmit({ name: name.trim(), description, startDate, endDate, visibility });
      if (saved) {
        await syncBoardLinks(saved.id);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isEdit = !!planning;

  return (
    <Modal title={isEdit ? 'Modifier la roadmap' : 'Nouvelle roadmap'} onClose={onClose}>
      <ModalBody>
        <FormField label="Nom de la roadmap" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Roadmap Q2 2026"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </FormField>

        <FormField label="Date de début" required>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setStartDateTouched(true); }}
            onBlur={() => setStartDateTouched(true)}
            style={startDateTouched ? { color: 'var(--text-primary)' } : undefined}
          />
        </FormField>

        <FormField label="Date de fin" required>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setEndDateTouched(true); }}
            onBlur={() => setEndDateTouched(true)}
            min={startDate || undefined}
            style={endDateTouched ? { color: 'var(--text-primary)' } : undefined}
          />
        </FormField>

        {!boardsLoading && availableBoards.length > 0 && (
          <FormField label="Delivery boards liés">
            <div className={styles.boardList}>
              {availableBoards.map(board => (
                <label key={board.id} className={styles.boardCheckbox}>
                  <input
                    type="checkbox"
                    checked={selectedBoardIds.has(board.id)}
                    onChange={() => toggleBoard(board.id)}
                  />
                  <span>{board.name}</span>
                </label>
              ))}
            </div>
          </FormField>
        )}

        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description optionnelle"
            rows={2}
          />
        </FormField>

        {!isEdit && (
          <FormField label="Visibilité">
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </FormField>
        )}

      </ModalBody>
      <ModalActions>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!name.trim() || !startDate || !endDate || submitting}>
          {submitting ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Créer'}
        </Button>
      </ModalActions>
    </Modal>
  );
}
