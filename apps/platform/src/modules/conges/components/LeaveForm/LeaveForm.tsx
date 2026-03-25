import { useState } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Member, Leave, LeaveFormData } from '../../types';
import styles from './LeaveForm.module.css';

interface LeaveFormProps {
  members: Member[];
  leave?: Leave | null;
  currentUser: { id: number; email: string; isAdmin: boolean } | null;
  onSubmit: (data: LeaveFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function LeaveForm({ members, leave, currentUser, onSubmit, onDelete, onClose }: LeaveFormProps) {
  const isAdmin = currentUser?.isAdmin ?? false;

  const [memberId, setMemberId] = useState<number>(leave?.memberId ?? currentUser?.id ?? (members[0]?.id || 0));
  const [startDate, setStartDate] = useState(leave?.startDate || '');
  const [endDate, setEndDate] = useState(leave?.endDate || '');
  const [startPeriod, setStartPeriod] = useState<'full' | 'morning' | 'afternoon'>(leave?.startPeriod || 'full');
  const [endPeriod, setEndPeriod] = useState<'full' | 'morning' | 'afternoon'>(leave?.endPeriod || 'full');
  const [reason, setReason] = useState(leave?.reason || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId || !startDate) return;
    onSubmit({ memberId, startDate, endDate: endDate || startDate, startPeriod, endPeriod, reason });
  };

  const isEdit = !!leave;

  return (
    <Modal title={isEdit ? 'Modifier le conge' : 'Poser un conge'} onClose={onClose} maxWidth={480}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {isAdmin ? (
          <div className={styles.field}>
            <label className={styles.label}>Membre</label>
            <select
              className={styles.select}
              value={memberId}
              onChange={(e) => setMemberId(Number(e.target.value))}
              required
            >
              <option value={0}>Selectionner un membre</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.email}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label}>Membre</label>
            <div className={styles.readonlyField}>{currentUser?.email}</div>
          </div>
        )}

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
            <label className={styles.label}>Periode debut</label>
            <select
              className={styles.select}
              value={startPeriod}
              onChange={(e) => setStartPeriod(e.target.value as 'full' | 'morning' | 'afternoon')}
            >
              <option value="full">Journee complete</option>
              <option value="morning">Matin</option>
              <option value="afternoon">Apres-midi</option>
            </select>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Date de fin</label>
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="Meme jour"
              min={startDate || undefined}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Periode fin</label>
            <select
              className={styles.select}
              value={endPeriod}
              onChange={(e) => setEndPeriod(e.target.value as 'full' | 'morning' | 'afternoon')}
            >
              <option value="full">Journee complete</option>
              <option value="morning">Matin</option>
              <option value="afternoon">Apres-midi</option>
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Motif</label>
          <input
            type="text"
            className={styles.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Conges payes, RTT, etc."
          />
        </div>

        <div className={styles.actions}>
          {isEdit && onDelete && (
            <button type="button" className={styles.deleteBtn} onClick={onDelete}>
              Supprimer
            </button>
          )}
          <div className={styles.rightActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className={styles.submitBtn}>
              {isEdit ? 'Modifier' : 'Ajouter'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
